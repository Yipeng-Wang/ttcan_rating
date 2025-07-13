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
from typing import List, Dict, Optional, Tuple
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

# ==== CONSTANTS ====
class ScraperConfig:
    TTCAN_BASE_URL = os.getenv("TTCAN_BASE_URL", "http://www.ttcan.ca/ratingSystem/ctta_ratings2.asp")
    CATEGORY_CODE = os.getenv("CATEGORY_CODE", "1")
    PERIOD_ISSUED = os.getenv("PERIOD_ISSUED", "412")
    SHEET_ID = os.getenv("GOOGLE_SHEET_ID")
    SHEET_NAME = os.getenv("GOOGLE_SHEET_NAME", "Sheet1")
    CREDS_JSON = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", "ttcan-rating-analysis-2ef44605707a.json")
    
    # Scraping constants
    MAX_RETRIES = 3
    REQUEST_TIMEOUT = 30
    PAGE_DELAY = 0.2
    CONCURRENT_WORKERS = 10
    HISTORY_CUTOFF_YEAR = 2010
    
    # Google Sheets constants
    BATCH_SIZE = 100
    BATCH_DELAY = 1

class ScraperValidation:
    REQUIRED_FIELDS = ["Name", "Province", "Rating", "Period", "Last Played"]
    MIN_COLUMNS_FOR_RATING_DATA = 5
    MIN_DATE_LENGTH = 5
    MAX_RATING = 5000

# ==== GOOGLE SHEETS SETUP ====
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]

def initialize_google_sheets() -> gspread.Worksheet:
    """Initialize and return Google Sheets connection."""
    try:
        if not ScraperConfig.SHEET_ID:
            raise ValueError("GOOGLE_SHEET_ID environment variable is required")
            
        creds = Credentials.from_service_account_file(ScraperConfig.CREDS_JSON, scopes=SCOPES)
        gc = gspread.authorize(creds)
        sheet = gc.open_by_key(ScraperConfig.SHEET_ID).worksheet(ScraperConfig.SHEET_NAME)
        logger.info("Google Sheets connection established")
        return sheet, gc
    except Exception as e:
        logger.error(f"Google Sheets setup error: {e}")
        sys.exit(1)

# Initialize sheets connection
sheet, gc = initialize_google_sheets()

# ==== DATA VALIDATION ====
def validate_player_data(player: Dict[str, str]) -> bool:
    """Validate that player data contains all required fields."""
    for field in ScraperValidation.REQUIRED_FIELDS:
        if field not in player or not player[field].strip():
            return False
    
    if "Gender" not in player:
        return False
    
    try:
        int(player["Rating"])
    except ValueError:
        return False
    
    return True

def is_valid_rating_entry(period_id: str, period_date: str, rating: str) -> bool:
    """Check if a rating entry is valid based on our criteria."""
    if not (rating and rating.isdigit()):
        return False
    
    if not (period_id and period_id.isdigit()):
        return False
    
    if not (period_date and len(period_date) > ScraperValidation.MIN_DATE_LENGTH):
        return False
    
    # Check if rating is within reasonable range
    rating_val = int(rating)
    if rating_val >= ScraperValidation.MAX_RATING:
        return False
    
    return True

def is_after_cutoff_year(period_date: str) -> bool:
    """Check if the period date is after the cutoff year."""
    try:
        # Parse year from period_date (assuming format like "April 5, 2022")
        year = int(period_date.split(', ')[-1])
        return year > ScraperConfig.HISTORY_CUTOFF_YEAR
    except (ValueError, IndexError):
        return False

# ==== AGE EXTRACTION ====
def extract_age_from_text(page_text: str) -> Optional[str]:
    """Extract age from page text using various patterns."""
    age_patterns = [
        r"Age:\s*(\d+)",
        r"DOB:\s*(\d{4}-\d{2}-\d{2})",
        r"Date of Birth:\s*(\d{4}-\d{2}-\d{2})",
        r"Born:\s*(\d{4})",
        r"Year of Birth:\s*(\d{4})",
    ]
    
    for pattern in age_patterns:
        match = re.search(pattern, page_text, re.IGNORECASE)
        if match:
            age_info = match.group(1)
            
            # Handle year of birth (4 digits)
            if len(age_info) == 4 and age_info.isdigit():
                birth_year = int(age_info)
                current_year = datetime.now().year
                return str(current_year - birth_year)
            
            # Handle full date of birth
            if '-' in age_info and len(age_info) == 10:
                try:
                    birth_date = datetime.strptime(age_info, '%Y-%m-%d')
                    current_date = datetime.now()
                    calculated_age = current_date.year - birth_date.year
                    if (current_date.month < birth_date.month or 
                        (current_date.month == birth_date.month and current_date.day < birth_date.day)):
                        calculated_age -= 1
                    return str(calculated_age)
                except ValueError:
                    continue
            
            # Handle direct age
            if age_info.isdigit():
                return age_info
    
    return None

def extract_age_from_tables(soup: BeautifulSoup) -> Optional[str]:
    """Extract age from table structures."""
    tables = soup.find_all("table")
    for table in tables:
        rows = table.find_all("tr")
        for row in rows:
            cells = row.find_all(["td", "th"])
            for i, cell in enumerate(cells):
                cell_text = cell.get_text(strip=True).lower()
                if any(keyword in cell_text for keyword in ["age", "dob", "date of birth", "born"]):
                    if i + 1 < len(cells):
                        next_cell = cells[i + 1].get_text(strip=True)
                        if next_cell.isdigit():
                            return next_cell
    return None

def extract_player_age(soup: BeautifulSoup) -> Optional[str]:
    """Extract player age from the soup object."""
    # Try text patterns first
    page_text = soup.get_text()
    age = extract_age_from_text(page_text)
    
    # If not found, try table structures
    if not age:
        age = extract_age_from_tables(soup)
    
    return age

# ==== RATING HISTORY EXTRACTION ====
def extract_rating_history_from_table(table, player_name: str) -> List[Dict[str, str]]:
    """Extract rating history from a single table."""
    history = []
    rows = table.find_all("tr")
    
    if len(rows) < 2:  # Need at least header + 1 data row
        return history
    
    for row in rows:
        cols = row.find_all(["td", "th"])
        if len(cols) < ScraperValidation.MIN_COLUMNS_FOR_RATING_DATA:
            continue
            
        col_texts = [col.get_text(strip=True) for col in cols]
        
        # Look for proper rating data structure: [Period_ID, Period_Date, Province, Gender, Rating]
        period_id = col_texts[0]
        period_date = col_texts[1]
        province = col_texts[2]
        gender = col_texts[3]
        rating = col_texts[4]
        
        if (is_valid_rating_entry(period_id, period_date, rating) and 
            is_after_cutoff_year(period_date)):
            
            history.append({
                "PlayerName": player_name,
                "Period": period_date,
                "Rating": rating,
                "LastPlayed": period_date
            })
    
    return history

def extract_player_rating_history(soup: BeautifulSoup, player_name: str) -> List[Dict[str, str]]:
    """Extract player rating history from the soup object."""
    all_history = []
    tables = soup.find_all("table")
    
    for table in tables:
        table_history = extract_rating_history_from_table(table, player_name)
        all_history.extend(table_history)
    
    return all_history

# ==== HTTP REQUESTS ====
def make_request_with_retries(url: str, params: Dict = None, timeout: int = None) -> requests.Response:
    """Make HTTP request with retry logic."""
    if timeout is None:
        timeout = ScraperConfig.REQUEST_TIMEOUT
    
    for attempt in range(ScraperConfig.MAX_RETRIES):
        try:
            response = requests.get(url, params=params, timeout=timeout)
            response.raise_for_status()
            return response
        except requests.exceptions.RequestException as e:
            logger.warning(f"Request failed (attempt {attempt + 1}/{ScraperConfig.MAX_RETRIES}): {e}")
            if attempt == ScraperConfig.MAX_RETRIES - 1:
                raise
            time.sleep(2 ** attempt)

def build_player_url(player_link: str) -> str:
    """Build full player URL from link."""
    if player_link.startswith('/'):
        return f"http://www.ttcan.ca{player_link}"
    elif player_link.startswith('http'):
        return player_link
    else:
        return f"http://www.ttcan.ca/ratingSystem/{player_link}"

# ==== MAIN SCRAPING FUNCTIONS ====
def fetch_player_page_data(player_link: str, player_name: str, fetch_history: bool = False) -> Tuple[Optional[str], List[Dict[str, str]]]:
    """Fetch both age and rating history from a single page visit."""
    age = None
    rating_history = []
    
    if not player_link:
        return age, rating_history
    
    try:
        full_url = build_player_url(player_link)
        response = make_request_with_retries(full_url, timeout=15)
        soup = BeautifulSoup(response.content, "html.parser")
        
        # Extract age
        age = extract_player_age(soup)
        
        # Extract rating history if requested
        if fetch_history:
            rating_history = extract_player_rating_history(soup, player_name)
        
        if fetch_history:
            logger.info(f"Found age: {age}, history entries: {len(rating_history)} for {player_name}")
        else:
            logger.info(f"Found age: {age} for {player_name}")
        
        return age, rating_history
        
    except Exception as e:
        logger.warning(f"Error fetching player data from {player_link}: {e}")
        return age, rating_history

def fetch_multiple_players_data(players_with_links: List[Tuple[str, str]], fetch_history: bool = False) -> Tuple[Dict[str, str], List[Dict[str, str]]]:
    """Fetch ages and optionally rating history for multiple players concurrently."""
    age_results = {}
    all_history = []
    
    def fetch_single_player(player_data):
        player_name, player_link = player_data
        age, history = fetch_player_page_data(player_link, player_name, fetch_history)
        return player_name, age, history
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=ScraperConfig.CONCURRENT_WORKERS) as executor:
        future_to_player = {
            executor.submit(fetch_single_player, player_data): player_data[0] 
            for player_data in players_with_links
        }
        
        for future in concurrent.futures.as_completed(future_to_player):
            player_name = future_to_player[future]
            try:
                name, age, history = future.result()
                age_results[name] = age
                if history:
                    all_history.extend(history)
                if not age:
                    logger.warning(f"Could not fetch age for {name}")
            except Exception as e:
                logger.error(f"Error fetching data for {player_name}: {e}")
                age_results[player_name] = None
    
    return age_results, all_history

def build_request_params(gender: str, page: int) -> Dict[str, str]:
    """Build request parameters for player listing page."""
    return {
        "Category_code": ScraperConfig.CATEGORY_CODE,
        "Period_Issued": ScraperConfig.PERIOD_ISSUED,
        "Sex": gender,
        "Formv_ctta_ratings_Page": page,
    }

def parse_player_row(row) -> Optional[Dict[str, str]]:
    """Parse a single player row from the table."""
    cols = row.find_all("td")
    if len(cols) < 7:
        return None
    
    # Extract player link
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
        "Age": "",
        "PlayerLink": player_link
    }
    
    return player if validate_player_data(player) else None

def scrape_players_page(gender: str, page: int) -> List[Dict[str, str]]:
    """Scrape a single page of players."""
    params = build_request_params(gender, page)
    
    try:
        response = make_request_with_retries(ScraperConfig.TTCAN_BASE_URL, params=params)
        soup = BeautifulSoup(response.content, "html.parser")
        table = soup.find("table", class_="resultTable")
        
        if not table:
            return []
        
        rows = table.find_all("tr")
        if len(rows) <= 1:
            return []
        
        players = []
        for row in rows[1:]:  # Skip header
            player = parse_player_row(row)
            if player:
                players.append(player)
            else:
                logger.debug(f"Skipped invalid row on page {page} (likely pagination/footer)")
        
        return players
        
    except Exception as e:
        logger.error(f"Error parsing page {page}: {e}")
        return []

def scrape_all_players_by_gender(gender: str, max_pages: Optional[int] = None, fetch_history: bool = False) -> Tuple[List[Dict[str, str]], List[Dict[str, str]]]:
    """Scrape all players of a specific gender."""
    all_players = []
    all_history = []
    page = 1
    
    logger.info(f"Scraping {gender or 'all'} players...")
    
    while True:
        if max_pages and page > max_pages:
            logger.info(f"Reached max pages limit ({max_pages}), stopping.")
            break
        
        logger.info(f"Fetching {gender or 'all'} page {page}...")
        page_players = scrape_players_page(gender, page)
        
        if not page_players:
            logger.info("No valid players found on this page. Stopping scraping.")
            break
        
        # Extract players with links for data fetching
        players_with_links = [
            (player["Name"], player["PlayerLink"]) 
            for player in page_players 
            if player["PlayerLink"]
        ]
        
        # Fetch ages and optionally history in one pass
        if players_with_links:
            if fetch_history:
                logger.info(f"Fetching ages and history for {len(players_with_links)} {gender or 'all'} players concurrently...")
                age_results, history_data = fetch_multiple_players_data(players_with_links, fetch_history=True)
                all_history.extend(history_data)
            else:
                logger.info(f"Fetching ages for {len(players_with_links)} {gender or 'all'} players concurrently...")
                age_results, _ = fetch_multiple_players_data(players_with_links, fetch_history=False)
            
            # Update players with age data
            for player in page_players:
                if player["Name"] in age_results:
                    player["Age"] = age_results[player["Name"]] or ""
        
        all_players.extend(page_players)
        logger.info(f"Page {page}: {len(page_players)} valid players")
        
        page += 1
        time.sleep(ScraperConfig.PAGE_DELAY)
    
    logger.info(f"Total {gender or 'all'} players found: {len(all_players)}")
    return all_players, all_history

def deduplicate_players(players: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Remove duplicate players based on name, rating, and province."""
    seen_players = set()
    unique_players = []
    
    for player in players:
        player_key = (player["Name"], player["Rating"], player["Province"])
        if player_key not in seen_players:
            seen_players.add(player_key)
            unique_players.append(player)
        else:
            logger.debug(f"Duplicate player found: {player['Name']} (Rating: {player['Rating']})")
    
    return unique_players

def enrich_history_with_player_data(history_data: List[Dict[str, str]], players: List[Dict[str, str]]) -> None:
    """Enrich history data with current player information."""
    player_lookup = {player["Name"]: player for player in players}
    
    for history_entry in history_data:
        player_name = history_entry["PlayerName"]
        if player_name in player_lookup:
            current_player = player_lookup[player_name]
            history_entry["Gender"] = current_player.get("Gender", "")
            history_entry["Province"] = current_player.get("Province", "")

def scrape_all_ttcan_players(fetch_all_history: bool = False) -> Tuple[List[Dict[str, str]], List[Dict[str, str]]]:
    """Scrape all players and optionally fetch rating history for all players."""
    logger.info("Starting to scrape all players...")
    
    # Scrape all players in one pass
    all_players, all_history = scrape_all_players_by_gender('', max_pages=None, fetch_history=fetch_all_history)
    
    # Deduplicate players
    unique_players = deduplicate_players(all_players)
    logger.info(f"Total unique players found: {len(unique_players)} (removed {len(all_players) - len(unique_players)} duplicates)")
    
    # Enrich history data if available
    if all_history:
        enrich_history_with_player_data(all_history, unique_players)
        logger.info(f"Collected {len(all_history)} historical rating entries")
    
    return unique_players, all_history

# ==== GOOGLE SHEETS FUNCTIONS ====
def write_to_sheet_in_batches(sheet_obj, rows: List[List[str]], header: List[str]) -> bool:
    """Write data to Google Sheets in batches."""
    try:
        # Clear and add header
        sheet_obj.clear()
        sheet_obj.append_row(header)
        
        # Write in batches
        for i in range(0, len(rows), ScraperConfig.BATCH_SIZE):
            batch = rows[i:i + ScraperConfig.BATCH_SIZE]
            sheet_obj.append_rows(batch, value_input_option="RAW")
            logger.info(f"Uploaded batch {i//ScraperConfig.BATCH_SIZE + 1}: {len(batch)} rows")
            time.sleep(ScraperConfig.BATCH_DELAY)
        
        return True
    except Exception as e:
        logger.error(f"Error writing to Google Sheet: {e}")
        return False

def write_players_to_sheet(players: List[Dict[str, str]]) -> bool:
    """Write player data to Google Sheets."""
    if not players:
        logger.warning("No players to write to sheet")
        return False
    
    header = ["Name", "Province", "Gender", "Rating", "Period", "Last Played", "Age"]
    rows = [
        [p["Name"], p["Province"], p["Gender"], p["Rating"], p["Period"], p["Last Played"], p.get("Age", "")]
        for p in players
    ]
    
    success = write_to_sheet_in_batches(sheet, rows, header)
    
    if success:
        # Log gender distribution
        gender_counts = {}
        for player in players:
            gender = player.get('Gender', 'Unknown')
            gender_counts[gender] = gender_counts.get(gender, 0) + 1
        logger.info(f"Gender distribution: {gender_counts}")
        logger.info(f"Successfully uploaded {len(rows)} rows to Google Sheet")
    
    return success

def write_history_to_sheet(history_data: List[Dict[str, str]]) -> bool:
    """Write rating history data to a separate Google Sheet."""
    if not history_data:
        logger.warning("No history data to write to sheet")
        return False
    
    try:
        # Get or create the RatingHistory sheet
        try:
            history_sheet = gc.open_by_key(ScraperConfig.SHEET_ID).worksheet("RatingHistory")
        except gspread.WorksheetNotFound:
            logger.info("Creating RatingHistory sheet...")
            spreadsheet = gc.open_by_key(ScraperConfig.SHEET_ID)
            history_sheet = spreadsheet.add_worksheet(title="RatingHistory", rows=10000, cols=6)
        
        header = ["PlayerName", "Period", "Rating", "LastPlayed", "Gender", "Province"]
        rows = [
            [entry.get("PlayerName", ""), entry.get("Period", ""), entry.get("Rating", ""),
             entry.get("LastPlayed", ""), entry.get("Gender", ""), entry.get("Province", "")]
            for entry in history_data
        ]
        
        success = write_to_sheet_in_batches(history_sheet, rows, header)
        
        if success:
            logger.info(f"Successfully uploaded {len(rows)} history entries to RatingHistory sheet")
        
        return success
        
    except Exception as e:
        logger.error(f"Error writing history to Google Sheet: {e}")
        return False


# ==== MAIN EXECUTION ====
if __name__ == "__main__":
    try:
        # Check command line arguments for history fetching
        fetch_history = "--history" in sys.argv
        
        players, history = scrape_all_ttcan_players(fetch_all_history=fetch_history)
        
        if players:
            success = write_players_to_sheet(players)
            if success:
                logger.info("Player data uploaded successfully")
                
                # If we have history data, upload it too
                if history:
                    history_success = write_history_to_sheet(history)
                    if history_success:
                        logger.info("Rating history uploaded successfully")
                    else:
                        logger.warning("Failed to upload rating history")
                
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