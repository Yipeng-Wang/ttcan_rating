import requests
from bs4 import BeautifulSoup
import gspread
from google.oauth2.service_account import Credentials
import time
import logging
import sys
import os
from dotenv import load_dotenv
from typing import List, Dict, Optional

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('scraper.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# ==== CONFIG ====
try:
    TTCAN_BASE_URL = os.getenv("TTCAN_BASE_URL", "http://www.ttcan.ca/ratingSystem/ctta_ratings2.asp")
    CATEGORY_CODE = os.getenv("CATEGORY_CODE", "1")
    PERIOD_ISSUED = os.getenv("PERIOD_ISSUED", "412")
    SEX = os.getenv("SEX", "F")
    SHEET_ID = os.getenv("GOOGLE_SHEET_ID")
    SHEET_NAME = os.getenv("GOOGLE_SHEET_NAME", "Sheet1")
    CREDS_JSON = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", "ttcan-rating-analysis-2ef44605707a.json")
    
    if not SHEET_ID:
        raise ValueError("GOOGLE_SHEET_ID environment variable is required")
        
    logger.info(f"Configuration loaded - Period: {PERIOD_ISSUED}, Sex: {SEX}")
    
except Exception as e:
    logger.error(f"Configuration error: {e}")
    sys.exit(1)

# ==== GOOGLE SHEETS SETUP ====
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]

try:
    creds = Credentials.from_service_account_file(CREDS_JSON, scopes=SCOPES)
    gc = gspread.authorize(creds)
    sheet = gc.open_by_key(SHEET_ID).worksheet(SHEET_NAME)
    logger.info("Google Sheets connection established")
except Exception as e:
    logger.error(f"Google Sheets setup error: {e}")
    sys.exit(1)

def validate_player_data(player: Dict[str, str]) -> bool:
    """Validate player data before processing."""
    required_fields = ["Name", "Province", "Gender", "Rating", "Period", "Last Played"]
    
    for field in required_fields:
        if field not in player or not player[field].strip():
            return False
    
    # Validate rating is numeric
    try:
        int(player["Rating"])
    except ValueError:
        return False
    
    return True

# ==== SCRAPE TTCAN RATINGS ACROSS ALL PAGES ====
def scrape_all_ttcan_players() -> List[Dict[str, str]]:
    """Scrape all TTCAN player ratings across multiple pages."""
    all_players = []
    page = 1
    max_retries = 3
    
    while True:
        logger.info(f"Fetching page {page}...")
        params = {
            "Category_code": CATEGORY_CODE,
            "Period_Issued": PERIOD_ISSUED,
            "Sex": SEX,
            "Formv_ctta_ratings_Page": page,
        }
        
        # Retry logic for network requests
        for attempt in range(max_retries):
            try:
                resp = requests.get(TTCAN_BASE_URL, params=params, timeout=30)
                resp.raise_for_status()
                break
            except requests.exceptions.RequestException as e:
                logger.warning(f"Request failed (attempt {attempt + 1}/{max_retries}): {e}")
                if attempt == max_retries - 1:
                    logger.error(f"Failed to fetch page {page} after {max_retries} attempts")
                    return all_players
                time.sleep(2 ** attempt)  # Exponential backoff
        
        try:
            soup = BeautifulSoup(resp.content, "html.parser")
            table = soup.find("table", class_="resultTable")
            
            if not table:
                logger.info("No player table found. Stopping.")
                break

            rows = table.find_all("tr")
            if len(rows) <= 1:
                logger.info("No player rows found. Stopping.")
                break

            players_this_page = 0
            for row in rows[1:]:  # Skip header
                cols = row.find_all("td")
                if len(cols) < 7:
                    continue
                    
                player = {
                    "Name": cols[1].get_text(strip=True),
                    "Province": cols[2].get_text(strip=True),
                    "Gender": cols[3].get_text(strip=True),
                    "Rating": cols[4].get_text(strip=True),
                    "Period": cols[5].get_text(strip=True),
                    "Last Played": cols[6].get_text(strip=True),
                }
                
                if validate_player_data(player):
                    all_players.append(player)
                    players_this_page += 1
                else:
                    logger.warning(f"Invalid player data: {player}")

            logger.info(f"Page {page}: {players_this_page} valid players")

            # Stop if no valid players found on this page
            if players_this_page == 0:
                logger.info("No valid players found on this page. Stopping scraping.")
                break

            # Go to next page, add delay to be polite
            page += 1
            time.sleep(1)
            
        except Exception as e:
            logger.error(f"Error parsing page {page}: {e}")
            break

    logger.info(f"Total players found: {len(all_players)}")
    return all_players

# ==== WRITE TO GOOGLE SHEET ====
def write_to_sheet(players: List[Dict[str, str]]) -> bool:
    """Write player data to Google Sheet."""
    if not players:
        logger.warning("No players to write to sheet")
        return False
    
    try:
        # Clear existing data except header
        sheet.resize(1)
        
        # Add header row
        header = ["Name", "Province", "Gender", "Rating", "Period", "Last Played"]
        sheet.append_row(header)
        
        # Prepare rows to append
        rows = [[
            p["Name"],
            p["Province"],
            p["Gender"],
            p["Rating"],
            p["Period"],
            p["Last Played"]
        ] for p in players]
        
        # Write rows in batches to avoid API limits
        batch_size = 100
        for i in range(0, len(rows), batch_size):
            batch = rows[i:i + batch_size]
            sheet.append_rows(batch, value_input_option="RAW")
            logger.info(f"Uploaded batch {i//batch_size + 1}: {len(batch)} rows")
            time.sleep(1)  # Rate limiting
        
        logger.info(f"Successfully uploaded {len(rows)} rows to Google Sheet")
        return True
        
    except Exception as e:
        logger.error(f"Error writing to Google Sheet: {e}")
        return False

if __name__ == "__main__":
    try:
        players = scrape_all_ttcan_players()
        if players:
            success = write_to_sheet(players)
            if success:
                logger.info("Scraping completed successfully")
            else:
                logger.error("Failed to write data to Google Sheet")
                sys.exit(1)
        else:
            logger.warning("No players found to upload")
    except KeyboardInterrupt:
        logger.info("Scraping interrupted by user")
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        sys.exit(1)