import requests
from bs4 import BeautifulSoup
import gspread
from google.oauth2.service_account import Credentials
import time
import logging
import sys
import os
import re
from datetime import datetime
from dotenv import load_dotenv
from typing import List, Dict, Optional
import concurrent.futures
from threading import Lock

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
    SHEET_ID = os.getenv("GOOGLE_SHEET_ID")
    SHEET_NAME = os.getenv("GOOGLE_SHEET_NAME", "Sheet1")
    CREDS_JSON = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", "ttcan-rating-analysis-2ef44605707a.json")
    
    if not SHEET_ID:
        raise ValueError("GOOGLE_SHEET_ID environment variable is required")
        
    logger.info(f"Configuration loaded - Period: {PERIOD_ISSUED}, scraping both genders")
    
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
    # Required fields - Gender can be empty
    required_fields = ["Name", "Province", "Rating", "Period", "Last Played"]
    
    for field in required_fields:
        if field not in player or not player[field].strip():
            return False
    
    # Gender is optional (can be empty)
    if "Gender" not in player:
        return False
    
    # Validate rating is numeric
    try:
        int(player["Rating"])
    except ValueError:
        return False
    
    return True

def fetch_player_age(player_link: str) -> Optional[str]:
    """Fetch player age from their detail page."""
    if not player_link:
        return None
        
    try:
        # Construct full URL if it's a relative link
        if player_link.startswith('/'):
            full_url = f"http://www.ttcan.ca{player_link}"
        elif player_link.startswith('http'):
            full_url = player_link
        else:
            # Handle relative URLs without leading slash
            full_url = f"http://www.ttcan.ca/ratingSystem/{player_link}"
        
        response = requests.get(full_url, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, "html.parser")
        
        # Look for age information in the player detail page
        # This might be in various formats, so we'll try multiple patterns
        
        # Method 1: Look for "Age:" or "DOB:" labels
        age_patterns = [
            r"Age:\s*(\d+)",
            r"DOB:\s*(\d{4}-\d{2}-\d{2})",
            r"Date of Birth:\s*(\d{4}-\d{2}-\d{2})",
            r"Born:\s*(\d{4})",
            r"Year of Birth:\s*(\d{4})",
        ]
        
        page_text = soup.get_text()
        for pattern in age_patterns:
            match = re.search(pattern, page_text, re.IGNORECASE)
            if match:
                age_info = match.group(1)
                
                # If it's a birth year, calculate age
                if len(age_info) == 4 and age_info.isdigit():
                    birth_year = int(age_info)
                    current_year = datetime.now().year
                    age = current_year - birth_year
                    return str(age)
                
                # If it's a date, calculate age
                if '-' in age_info and len(age_info) == 10:
                    birth_date = datetime.strptime(age_info, '%Y-%m-%d')
                    current_date = datetime.now()
                    age = current_date.year - birth_date.year
                    if current_date.month < birth_date.month or (current_date.month == birth_date.month and current_date.day < birth_date.day):
                        age -= 1
                    return str(age)
                
                # If it's already an age
                if age_info.isdigit():
                    return age_info
        
        # Method 2: Look in specific table structures
        tables = soup.find_all("table")
        for table in tables:
            rows = table.find_all("tr")
            for row in rows:
                cells = row.find_all(["td", "th"])
                for i, cell in enumerate(cells):
                    cell_text = cell.get_text(strip=True).lower()
                    if any(keyword in cell_text for keyword in ["age", "dob", "date of birth", "born"]):
                        # Look for the value in the next cell
                        if i + 1 < len(cells):
                            next_cell = cells[i + 1].get_text(strip=True)
                            if next_cell.isdigit():
                                return next_cell
        
        return None
        
    except Exception as e:
        logger.warning(f"Error fetching player age from {player_link}: {e}")
        return None

def fetch_ages_concurrently(players_with_links: List[tuple]) -> Dict[str, str]:
    """Fetch ages for multiple players concurrently."""
    age_results = {}
    
    def fetch_single_age(player_data):
        player_name, player_link = player_data
        age = fetch_player_age(player_link)
        return player_name, age
    
    # Use ThreadPoolExecutor for concurrent requests
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        future_to_player = {executor.submit(fetch_single_age, player_data): player_data[0] 
                           for player_data in players_with_links}
        
        for future in concurrent.futures.as_completed(future_to_player):
            player_name = future_to_player[future]
            try:
                name, age = future.result()
                age_results[name] = age
                if age:
                    logger.info(f"Found age {age} for {name}")
                else:
                    logger.warning(f"Could not fetch age for {name}")
            except Exception as e:
                logger.error(f"Error fetching age for {player_name}: {e}")
                age_results[player_name] = None
    
    return age_results

# ==== SCRAPE TTCAN RATINGS ACROSS ALL PAGES ====
def scrape_ttcan_players_by_gender(gender: str) -> List[Dict[str, str]]:
    """Scrape TTCAN player ratings for a specific gender across multiple pages."""
    all_players = []
    page = 1
    max_retries = 3
    
    logger.info(f"Scraping {gender} players...")
    
    while True:
        logger.info(f"Fetching {gender} page {page}...")
        params = {
            "Category_code": CATEGORY_CODE,
            "Period_Issued": PERIOD_ISSUED,
            "Sex": gender,
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

            # First, collect all players with their links
            page_players = []
            players_with_links = []
            
            for idx, row in enumerate(rows[1:]):  # Skip header
                cols = row.find_all("td")
                if len(cols) < 7:
                    continue
                
                # Extract player link for age fetching
                player_link = None
                name_cell = cols[1]
                link_tag = name_cell.find("a")
                if link_tag and link_tag.get("href"):
                    player_link = link_tag.get("href")
                    
                player = {
                    "Name": cols[1].get_text(strip=True),
                    "Province": cols[2].get_text(strip=True),
                    "Gender": cols[3].get_text(strip=True),
                    "Rating": cols[4].get_text(strip=True),
                    "Period": cols[5].get_text(strip=True),
                    "Last Played": cols[6].get_text(strip=True),
                    "Age": ""  # Will be filled by age fetching
                }
                
                if validate_player_data(player):
                    page_players.append(player)
                    if player_link:
                        players_with_links.append((player["Name"], player_link))
                else:
                    logger.warning(f"Invalid player data: {player}")
            
            # Fetch ages concurrently for this page (for all players)
            if players_with_links:
                logger.info(f"Fetching ages for {len(players_with_links)} {gender} players concurrently...")
                age_results = fetch_ages_concurrently(players_with_links)
                
                # Update players with age information
                for player in page_players:
                    if player["Name"] in age_results:
                        player["Age"] = age_results[player["Name"]] or ""
            
            # Add validated players to the main list
            players_this_page = len(page_players)
            all_players.extend(page_players)

            logger.info(f"Page {page}: {players_this_page} valid players")

            # Stop if no valid players found on this page
            if players_this_page == 0:
                logger.info("No valid players found on this page. Stopping scraping.")
                break

            # Go to next page, add small delay to be polite
            page += 1
            time.sleep(0.2)
            
        except Exception as e:
            logger.error(f"Error parsing page {page}: {e}")
            break

    logger.info(f"Total {gender} players found: {len(all_players)}")
    return all_players

def scrape_all_ttcan_players() -> List[Dict[str, str]]:
    """Scrape all TTCAN player ratings."""
    all_players = []
    
    # Scrape all players without gender filtering (use empty string to get all)
    logger.info("Starting to scrape all players...")
    all_players = scrape_ttcan_players_by_gender('')
    
    # Deduplicate players based on name + rating combination
    seen_players = set()
    unique_players = []
    
    for player in all_players:
        player_key = (player["Name"], player["Rating"], player["Province"])
        if player_key not in seen_players:
            seen_players.add(player_key)
            unique_players.append(player)
        else:
            logger.debug(f"Duplicate player found: {player['Name']} (Rating: {player['Rating']})")
    
    logger.info(f"Total unique players found: {len(unique_players)} (removed {len(all_players) - len(unique_players)} duplicates)")
    return unique_players

# ==== WRITE TO GOOGLE SHEET ====
def write_to_sheet(players: List[Dict[str, str]]) -> bool:
    """Write player data to Google Sheet."""
    if not players:
        logger.warning("No players to write to sheet")
        return False
    
    try:
        # Clear all existing data first
        sheet.clear()
        
        # Add header row
        header = ["Name", "Province", "Gender", "Rating", "Period", "Last Played", "Age"]
        sheet.append_row(header)
        
        # Prepare rows to append
        rows = [[
            p["Name"],
            p["Province"],
            p["Gender"],
            p["Rating"],
            p["Period"],
            p["Last Played"],
            p.get("Age", "")
        ] for p in players]
        
        # Write rows in batches to avoid API limits
        batch_size = 100
        for i in range(0, len(rows), batch_size):
            batch = rows[i:i + batch_size]
            sheet.append_rows(batch, value_input_option="RAW")
            logger.info(f"Uploaded batch {i//batch_size + 1}: {len(batch)} rows")
            time.sleep(1)  # Rate limiting
        
        # Log gender distribution
        gender_counts = {}
        for player in players:
            gender = player.get('Gender', 'Unknown')
            gender_counts[gender] = gender_counts.get(gender, 0) + 1
        
        logger.info(f"Gender distribution: {gender_counts}")
        
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