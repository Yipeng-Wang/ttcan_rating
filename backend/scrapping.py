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
import json
import tempfile

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
    SHEET_ID = os.getenv("GOOGLE_SHEET_ID")
    SHEET_NAME = os.getenv("GOOGLE_SHEET_NAME", "Sheet1")
    CREDS_JSON = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", "ttcan-rating-analysis-2ef44605707a.json")

    PERIOD_ISSUED = os.getenv("PERIOD_ISSUED", "414")
    
    # Scraping constants
    MAX_RETRIES = 3
    REQUEST_TIMEOUT = 30
    PAGE_DELAY = 0.2
    CONCURRENT_WORKERS = 20
    HISTORY_CUTOFF_YEAR = 2010
    
    # Google Sheets constants
    BATCH_SIZE = 5000  # Very large batch size for maximum upload efficiency
    BATCH_DELAY = 2    # Increased delay between batches to respect rate limits

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

def scrape_all_players_by_gender(gender: str, max_pages: Optional[int] = None, fetch_history: bool = False, 
                                session_id: str = None, resume_from_page: int = 1) -> Tuple[List[Dict[str, str]], List[Dict[str, str]]]:
    """Scrape all players of a specific gender with resume capability."""
    all_players = []
    all_history = []
    page = resume_from_page
    
    logger.info(f"Scraping {gender or 'all'} players starting from page {page}...")
    
    # Save progress every N pages to allow resuming
    save_progress_every = 5
    
    while True:
        try:
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
            logger.info(f"Page {page}: {len(page_players)} valid players (Total so far: {len(all_players)})")
            
            # Save progress periodically
            if session_id and page % save_progress_every == 0:
                save_progress_state(session_id, page, all_players, all_history)
                update_temp_files_incremental(all_players, all_history, session_id)
                logger.info(f"Progress checkpoint saved at page {page}")
            
            page += 1
            time.sleep(ScraperConfig.PAGE_DELAY)
            
        except Exception as e:
            logger.error(f"Error scraping page {page}: {e}")
            
            # Save progress before potentially failing
            if session_id:
                logger.info(f"Saving progress before handling error...")
                save_progress_state(session_id, page - 1, all_players, all_history)
                update_temp_files_incremental(all_players, all_history, session_id)
            
            # Re-raise the exception to be handled by the calling function
            raise e
    
    # Save final progress
    if session_id:
        save_progress_state(session_id, page - 1, all_players, all_history)
        update_temp_files_incremental(all_players, all_history, session_id)
    
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

def scrape_all_ttcan_players(fetch_all_history: bool = False, session_id: str = None, 
                            resume_from_page: int = 1) -> Tuple[List[Dict[str, str]], List[Dict[str, str]]]:
    """Scrape all players and optionally fetch rating history for all players with resume capability."""
    if not session_id:
        session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    logger.info(f"Starting to scrape all players... (Session: {session_id})")
    
    # Scrape all players in one pass with resume capability
    all_players, all_history = scrape_all_players_by_gender('', max_pages=None, 
                                                           fetch_history=fetch_all_history,
                                                           session_id=session_id,
                                                           resume_from_page=resume_from_page)
    
    # Deduplicate players
    unique_players = deduplicate_players(all_players)
    logger.info(f"Total unique players found: {len(unique_players)} (removed {len(all_players) - len(unique_players)} duplicates)")
    
    # Enrich history data if available
    if all_history:
        enrich_history_with_player_data(all_history, unique_players)
        logger.info(f"Collected {len(all_history)} historical rating entries")
    
    return unique_players, all_history

# ==== LOCAL FILE CACHING ====
def save_data_to_temp_file(data: List[Dict], data_type: str, session_id: str = None) -> str:
    """Save scraped data to a temporary file and return the file path."""
    if session_id is None:
        session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    filename = f"ttcan_{data_type}_{session_id}.json"
    
    # Create temp file in the same directory as the script
    temp_dir = os.path.dirname(os.path.abspath(__file__))
    file_path = os.path.join(temp_dir, filename)
    
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        logger.info(f"Saved {len(data)} {data_type} records to {filename}")
        return file_path
    
    except Exception as e:
        logger.error(f"Failed to save {data_type} data to file: {e}")
        return None

def save_progress_state(session_id: str, last_page: int, completed_players: List[Dict], completed_history: List[Dict], 
                       upload_state: Dict = None) -> str:
    """Save current scraping and upload progress state."""
    progress_data = {
        "session_id": session_id,
        "last_completed_page": last_page,
        "timestamp": datetime.now().isoformat(),
        "players_count": len(completed_players),
        "history_count": len(completed_history),
        "status": "in_progress",
        "upload_state": upload_state or {}
    }
    
    filename = f"ttcan_progress_{session_id}.json"
    temp_dir = os.path.dirname(os.path.abspath(__file__))
    file_path = os.path.join(temp_dir, filename)
    
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(progress_data, f, indent=2)
        
        logger.info(f"Progress saved: page {last_page}, {len(completed_players)} players, {len(completed_history)} history entries")
        if upload_state:
            logger.info(f"Upload state: {upload_state}")
        return file_path
    
    except Exception as e:
        logger.error(f"Failed to save progress state: {e}")
        return None


def load_progress_state(session_id: str = None) -> Dict:
    """Load the most recent progress state."""
    temp_dir = os.path.dirname(os.path.abspath(__file__))
    
    try:
        if session_id:
            # Load specific session
            progress_file = os.path.join(temp_dir, f"ttcan_progress_{session_id}.json")
            if os.path.exists(progress_file):
                with open(progress_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
        else:
            # Find the most recent progress file
            progress_files = [f for f in os.listdir(temp_dir) if f.startswith('ttcan_progress_') and f.endswith('.json')]
            if progress_files:
                latest_file = max(progress_files)
                progress_file = os.path.join(temp_dir, latest_file)
                with open(progress_file, 'r', encoding='utf-8') as f:
                    progress_data = json.load(f)
                    logger.info(f"Found previous session: {progress_data.get('session_id', 'unknown')}")
                    return progress_data
    
    except Exception as e:
        logger.error(f"Failed to load progress state: {e}")
    
    return {}

def update_temp_files_incremental(players: List[Dict], history: List[Dict], session_id: str):
    """Update temp files incrementally during scraping."""
    try:
        # Save current progress
        players_file = save_data_to_temp_file(players, "players", session_id)
        history_file = save_data_to_temp_file(history, "history", session_id) if history else None
        
        return players_file, history_file
    except Exception as e:
        logger.error(f"Failed to update temp files: {e}")
        return None, None

def load_data_from_temp_file(file_path: str, data_type: str) -> List[Dict]:
    """Load data from a temporary file."""
    try:
        if not os.path.exists(file_path):
            logger.warning(f"Temp file not found: {file_path}")
            return []
        
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        logger.info(f"Loaded {len(data)} {data_type} records from {os.path.basename(file_path)}")
        return data
    
    except Exception as e:
        logger.error(f"Failed to load {data_type} data from file: {e}")
        return []

def cleanup_temp_files(*file_paths):
    """Remove temporary files after successful upload."""
    for file_path in file_paths:
        if file_path and os.path.exists(file_path):
            try:
                os.remove(file_path)
                logger.info(f"Cleaned up temp file: {os.path.basename(file_path)}")
            except Exception as e:
                logger.warning(f"Failed to remove temp file {file_path}: {e}")

def cleanup_session_files(session_id: str):
    """Remove all files related to a specific session."""
    if not session_id:
        return
    
    temp_dir = os.path.dirname(os.path.abspath(__file__))
    
    try:
        # Find all files with this session ID
        session_files = [
            f for f in os.listdir(temp_dir) 
            if f.endswith('.json') and session_id in f
        ]
        
        for filename in session_files:
            file_path = os.path.join(temp_dir, filename)
            try:
                os.remove(file_path)
                logger.info(f"Cleaned up session file: {filename}")
            except Exception as e:
                logger.warning(f"Failed to remove session file {filename}: {e}")
                
    except Exception as e:
        logger.error(f"Error during session cleanup: {e}")

def find_latest_temp_files() -> Tuple[Optional[str], Optional[str]]:
    """Find the most recent temp files for players and history."""
    temp_dir = os.path.dirname(os.path.abspath(__file__))
    
    players_file = None
    history_file = None
    
    try:
        # Find all temp files
        temp_files = [f for f in os.listdir(temp_dir) if f.startswith('ttcan_') and f.endswith('.json')]
        
        # Find latest players file
        players_files = [f for f in temp_files if 'players_' in f]
        if players_files:
            players_file = os.path.join(temp_dir, max(players_files))
        
        # Find latest history file
        history_files = [f for f in temp_files if 'history_' in f]
        if history_files:
            history_file = os.path.join(temp_dir, max(history_files))
        
        if players_file:
            logger.info(f"Found latest players file: {os.path.basename(players_file)}")
        if history_file:
            logger.info(f"Found latest history file: {os.path.basename(history_file)}")
    
    except Exception as e:
        logger.error(f"Error finding temp files: {e}")
    
    return players_file, history_file

# ==== GOOGLE SHEETS FUNCTIONS ====
def handle_google_api_error(error) -> bool:
    """Check if error is retryable (like 502, 503, rate limits)."""
    error_str = str(error).lower()
    
    # Check for retryable HTTP errors
    retryable_errors = [
        '502', '503', '504',  # Server errors
        'server error', 'temporarily unavailable',
        'rate limit', 'quota exceeded',
        'timeout', 'connection error',
        'internal error',  # Google internal errors
        'backend error',   # Google backend issues
        'that\'s an error'  # The specific error from your log
    ]
    
    # Non-retryable errors (authentication, permissions, etc.)
    non_retryable = [
        'authentication', 'unauthorized', '401', '403',
        'not found', '404', 'permission denied'
    ]
    
    # If it's explicitly non-retryable, return False
    if any(err in error_str for err in non_retryable):
        return False
    
    # Otherwise check if it's a retryable error
    return any(err in error_str for err in retryable_errors)

def write_to_sheet_with_retry(sheet_obj, rows: List[List[str]], header: List[str], max_retries: int = 3) -> bool:
    """Write data to Google Sheets with retry logic for 502/503 errors."""
    
    total_batches = (len(rows) + ScraperConfig.BATCH_SIZE - 1) // ScraperConfig.BATCH_SIZE
    
    # Clear sheet and add header
    sheet_obj.clear()
    sheet_obj.append_row(header)
    
    for session_attempt in range(max_retries):
        try:
            logger.info(f"Attempting to write to Google Sheet (attempt {session_attempt + 1}/{max_retries})")
            logger.info(f"📤 Starting upload - {total_batches} batches of {ScraperConfig.BATCH_SIZE} rows each")
            
            # Upload all batches
            for batch_idx in range(total_batches):
                start_idx = batch_idx * ScraperConfig.BATCH_SIZE
                end_idx = min(start_idx + ScraperConfig.BATCH_SIZE, len(rows))
                batch = rows[start_idx:end_idx]
                
                logger.info(f"📦 Uploading batch {batch_idx + 1}/{total_batches}: {len(batch)} rows (rows {start_idx + 1}-{end_idx})")
                
                batch_attempt = 0
                batch_max_retries = 2
                
                while batch_attempt < batch_max_retries:
                    try:
                        sheet_obj.append_rows(batch, value_input_option="RAW")
                        logger.info(f"✅ Batch {batch_idx + 1}/{total_batches} uploaded successfully")
                        break
                    except Exception as batch_error:
                        batch_attempt += 1
                        if handle_google_api_error(batch_error) and batch_attempt < batch_max_retries:
                            wait_time = (2 ** batch_attempt) + 1
                            logger.warning(f"⚠️  Batch {batch_idx + 1} failed (retry {batch_attempt}/{batch_max_retries}), retrying in {wait_time}s: {batch_error}")
                            time.sleep(wait_time)
                        else:
                            logger.error(f"❌ Batch {batch_idx + 1} failed after {batch_max_retries} attempts: {batch_error}")
                            raise batch_error
                
                time.sleep(ScraperConfig.BATCH_DELAY)
            
            logger.info(f"🎉 Upload completed successfully - {len(rows)} total rows uploaded")
            return True
            
        except Exception as e:
            if handle_google_api_error(e) and session_attempt < max_retries - 1:
                wait_time = (2 ** session_attempt) * 5  # Exponential backoff: 5s, 10s, 20s
                logger.warning(f"💥 Upload session {session_attempt + 1} failed, retrying entire session in {wait_time}s: {e}")
                time.sleep(wait_time)
                # Clear and re-add header for retry
                sheet_obj.clear()
                sheet_obj.append_row(header)
            else:
                logger.error(f"🔥 Upload failed permanently after {max_retries} session attempts: {e}")
                return False
    
    return False

def write_to_sheet_in_batches(sheet_obj, rows: List[List[str]], header: List[str]) -> bool:
    """Write data to Google Sheets in batches with retry logic."""
    return write_to_sheet_with_retry(sheet_obj, rows, header)

def write_players_to_sheet(players: List[Dict[str, str]], session_id: str = None) -> bool:
    """Write player data to Google Sheets with resumable upload."""
    if not players:
        logger.warning("No players to write to sheet")
        return False
    
    header = ["Name", "Province", "Gender", "Rating", "Period", "Last Played", "Age"]
    rows = [
        [p["Name"], p["Province"], p["Gender"], p["Rating"], p["Period"], p["Last Played"], p.get("Age", "")]
        for p in players
    ]
    
    success = write_to_sheet_with_retry(sheet, rows, header)
    
    if success:
        # Log gender distribution
        gender_counts = {}
        for player in players:
            gender = player.get('Gender', 'Unknown')
            gender_counts[gender] = gender_counts.get(gender, 0) + 1
        logger.info(f"Gender distribution: {gender_counts}")
        logger.info(f"Successfully uploaded {len(rows)} rows to Google Sheet")
    
    return success

def write_history_to_sheet(history_data: List[Dict[str, str]], session_id: str = None) -> bool:
    """Write rating history data to a separate Google Sheet with resumable upload."""
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
        
        success = write_to_sheet_with_retry(history_sheet, rows, header)
        
        if success:
            logger.info(f"Successfully uploaded {len(rows)} history entries to RatingHistory sheet")
        
        return success
        
    except Exception as e:
        logger.error(f"Error writing history to Google Sheet: {e}")
        return False


# ==== MAIN EXECUTION ====
if __name__ == "__main__":
    players_temp_file = None
    history_temp_file = None
    
    try:
        # Check command line arguments
        fetch_history = "--history" in sys.argv
        use_cache = "--use-cache" in sys.argv
        resume = "--resume" in sys.argv
        
        # Show upload status if requested
        if "--status" in sys.argv:
            progress_state = load_progress_state()
            if progress_state:
                session_id = progress_state.get("session_id")
                print(f"\nSession: {session_id}")
                print(f"Last updated: {progress_state.get('timestamp', 'Unknown')}")
                print(f"Scraping status: {progress_state.get('status', 'Unknown')}")
                print(f"Players: {progress_state.get('players_count', 0)}")
                print(f"History entries: {progress_state.get('history_count', 0)}")
                
                upload_state = progress_state.get("upload_state", {})
                if upload_state:
                    print("\nUpload Status:")
                    for upload_type, state in upload_state.items():
                        status = state.get("status", "unknown")
                        completed = state.get("completed_batches", 0)
                        total = state.get("total_batches", 0)
                        percentage = (completed / total * 100) if total > 0 else 0
                        print(f"  {upload_type.capitalize()}: {status} ({completed}/{total} batches, {percentage:.1f}%)")
                else:
                    print("No upload status available")
            else:
                print("No session found")
            sys.exit(0)
        
        # Show help if requested
        if "--help" in sys.argv or "-h" in sys.argv:
            print("""
TTCan Rating Scraper

Usage:
  python scrapping.py                    # Scrape current players only
  python scrapping.py --history          # Scrape players + rating history
  python scrapping.py --use-cache        # Use cached data instead of re-scraping
  python scrapping.py --resume           # Resume from last interrupted scraping session
  python scrapping.py --status           # Show current session and upload status

Options:
  --history      Fetch rating history for all players (slower)
  --use-cache    Use previously cached data instead of re-scraping
  --resume       Resume from the last interrupted scraping session
  --status       Show progress and upload status of current session
  --help, -h     Show this help message

Examples:
  # Normal run (players only)
  python scrapping.py
  
  # Full run with history
  python scrapping.py --history
  
  # Check current session status
  python scrapping.py --status
  
  # Retry upload after Google Sheets failure (resumes from failed batch)
  python scrapping.py --use-cache
  
  # Resume interrupted scraping session
  python scrapping.py --resume
  
  # Resume interrupted scraping with history
  python scrapping.py --history --resume
            """)
            sys.exit(0)
        
        players = []
        history = []
        session_id = None
        resume_from_page = 1
        
        if resume:
            # Try to resume from previous session
            logger.info("Attempting to resume from previous session...")
            progress_state = load_progress_state()
            
            if progress_state:
                session_id = progress_state.get("session_id")
                resume_from_page = progress_state.get("last_completed_page", 1) + 1
                
                # Load existing data from the session
                players_temp_file, history_temp_file = find_latest_temp_files()
                if players_temp_file and session_id in players_temp_file:
                    players = load_data_from_temp_file(players_temp_file, "players")
                
                if fetch_history and history_temp_file and session_id in history_temp_file:
                    history = load_data_from_temp_file(history_temp_file, "history")
                
                logger.info(f"Resuming session {session_id} from page {resume_from_page}")
                logger.info(f"Already have {len(players)} players and {len(history)} history entries")
            else:
                logger.warning("No previous session found to resume, starting fresh")
                resume = False
        
        if use_cache and not resume:
            # Try to load from existing temp files
            logger.info("Attempting to use cached data...")
            players_temp_file, history_temp_file = find_latest_temp_files()
            
            if players_temp_file:
                players = load_data_from_temp_file(players_temp_file, "players")
                # Extract session_id from filename for resumable uploads
                import re
                match = re.search(r'ttcan_players_(\d{8}_\d{6})\.json', players_temp_file)
                if match:
                    session_id = match.group(1)
            
            if fetch_history and history_temp_file:
                history = load_data_from_temp_file(history_temp_file, "history")
            
            if not players:
                logger.warning("No valid cached player data found, will scrape fresh data")
                use_cache = False
        
        if not use_cache and not resume:
            # Scrape fresh data from TTCan
            logger.info("Scraping fresh data from TTCan...")
            session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
            players, history = scrape_all_ttcan_players(fetch_all_history=fetch_history, session_id=session_id)
            
            # Save to temp files immediately after scraping
            if players:
                players_temp_file = save_data_to_temp_file(players, "players", session_id)
                
            if history:
                history_temp_file = save_data_to_temp_file(history, "history", session_id)
        
        elif resume:
            # Continue scraping from where we left off
            logger.info(f"Continuing scraping from page {resume_from_page}...")
            try:
                new_players, new_history = scrape_all_ttcan_players(
                    fetch_all_history=fetch_history, 
                    session_id=session_id, 
                    resume_from_page=resume_from_page
                )
                
                # Merge new data with existing data
                players.extend(new_players)
                history.extend(new_history)
                
                # Save updated data
                players_temp_file = save_data_to_temp_file(players, "players", session_id)
                if history:
                    history_temp_file = save_data_to_temp_file(history, "history", session_id)
                
                logger.info(f"Resume completed. Total: {len(players)} players, {len(history)} history entries")
                
            except Exception as e:
                logger.error(f"Error during resume: {e}")
                logger.info("Progress has been saved. You can try to resume again later.")
                raise
        
        if players:
            # Attempt to upload to Google Sheets
            logger.info("Uploading player data to Google Sheets...")
            success = write_players_to_sheet(players, session_id=session_id)
            
            if success:
                logger.info("Player data uploaded successfully")
                
                # If we have history data, upload it too
                if history:
                    logger.info("Uploading rating history to Google Sheets...")
                    history_success = write_history_to_sheet(history, session_id=session_id)
                    if history_success:
                        logger.info("Rating history uploaded successfully")
                        
                        # Clean up all session files after successful upload
                        cleanup_session_files(session_id)
                    else:
                        logger.warning("Failed to upload rating history - temp files preserved for retry")
                        logger.info("Use --use-cache to retry history upload without re-scraping")
                else:
                    # Clean up all session files if no history to upload
                    cleanup_session_files(session_id)
                
                logger.info("Scraping and upload completed successfully")
            else:
                logger.error("Failed to write player data to Google Sheet")
                logger.info(f"Data preserved in temp files for retry:")
                if players_temp_file:
                    logger.info(f"  Players: {os.path.basename(players_temp_file)}")
                if history_temp_file:
                    logger.info(f"  History: {os.path.basename(history_temp_file)}")
                logger.info("Commands to retry:")
                logger.info("  --use-cache          # Retry upload (resumes from failed batch)")
                logger.info("  --status             # Check upload progress")
                sys.exit(1)
        else:
            logger.warning("No players found to upload")
            
    except KeyboardInterrupt:
        logger.info("Scraping interrupted by user")
        if players_temp_file or history_temp_file:
            logger.info("Temp files preserved - use --use-cache to retry upload")
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        if players_temp_file or history_temp_file:
            logger.info("Temp files preserved - use --use-cache to retry upload")
        sys.exit(1)