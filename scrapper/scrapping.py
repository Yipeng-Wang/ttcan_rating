import requests
from bs4 import BeautifulSoup
import gspread
from google.oauth2.service_account import Credentials
import time

# ==== CONFIG ====
TTCAN_BASE_URL = "http://www.ttcan.ca/ratingSystem/ctta_ratings2.asp"
CATEGORY_CODE = "1"   # All/Tous
PERIOD_ISSUED = "412" # July 6, 2025
SEX = "F"             # Female
SHEET_ID = "1tYJE2Jqi5VKB3psPvx6Ls7zahmUt-d6qruJ61V2rNB4"  # <-- Replace with your Google Sheet ID
SHEET_NAME = "Sheet1"
CREDS_JSON = "ttcan-rating-analysis-2ef44605707a.json"

# ==== GOOGLE SHEETS SETUP ====
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]
creds = Credentials.from_service_account_file(CREDS_JSON, scopes=SCOPES)
gc = gspread.authorize(creds)
sheet = gc.open_by_key(SHEET_ID).worksheet(SHEET_NAME)

# ==== SCRAPE TTCAN RATINGS ACROSS ALL PAGES ====
def scrape_all_ttcan_players():
    all_players = []
    page = 1

    while True:
        print(f"Fetching page {page}...")
        params = {
            "Category_code": CATEGORY_CODE,
            "Period_Issued": PERIOD_ISSUED,
            "Sex": SEX,
            "Formv_ctta_ratings_Page": page,
        }
        resp = requests.get(TTCAN_BASE_URL, params=params)
        soup = BeautifulSoup(resp.content, "html.parser")

        table = soup.find("table", class_="resultTable")
        if not table:
            print("No player table found. Stopping.")
            break

        rows = table.find_all("tr")
        if len(rows) <= 1:
            print("No player rows found. Stopping.")
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
            all_players.append(player)
            players_this_page += 1

        print(f"Page {page}: {players_this_page} players")

        # there is one dummy player on an empty page.
        if players_this_page == 1 and len(player["Name"]) == 0:
            break

        # Go to next page, add delay to be polite
        page += 1
        time.sleep(1)

    print(f"Total players found: {len(all_players)}")
    return all_players

# ==== WRITE TO GOOGLE SHEET ====
def write_to_sheet(players):
    # Optional: Clear existing data except header
    sheet.resize(1)
    # Prepare rows to append (keep header row at top)
    rows = [[
        p["Name"],
        p["Province"],
        p["Gender"],
        p["Rating"],
        p["Period"],
        p["Last Played"]
    ] for p in players]
    # Write rows
    sheet.append_rows(rows, value_input_option="RAW")
    print(f"Uploaded {len(rows)} rows to Google Sheet")

if __name__ == "__main__":
    players = scrape_all_ttcan_players()
    write_to_sheet(players)
