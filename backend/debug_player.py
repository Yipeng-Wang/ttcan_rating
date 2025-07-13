import requests
from bs4 import BeautifulSoup
import re
from datetime import datetime

def debug_player_page(player_name=None):
    if player_name is None:
        player_name = input("Enter the player name to debug: ").strip()
        if not player_name:
            print("No player name provided. Exiting.")
            return
    
    # First, let's search for the player to get their link
    base_url = "http://www.ttcan.ca/ratingSystem/ctta_ratings2.asp"
    params = {
        "Category_code": "1",
        "Period_Issued": "412",
        "Sex": "",
        "Formv_ctta_ratings_Page": 1,
    }
    
    print(f"Searching for {player_name}...")
    
    # Search through pages to find the player
    for page in range(1, 50):  # Search first 50 pages
        params["Formv_ctta_ratings_Page"] = page
        resp = requests.get(base_url, params=params, timeout=30)
        soup = BeautifulSoup(resp.content, "html.parser")
        table = soup.find("table", class_="resultTable")
        
        if not table:
            break
            
        rows = table.find_all("tr")
        for row in rows[1:]:  # Skip header
            cols = row.find_all("td")
            if len(cols) >= 7:
                name = cols[1].get_text(strip=True)
                if player_name.upper() in name.upper():
                    print(f"Found target player: {name}")
                    link_tag = cols[1].find("a")
                    if link_tag and link_tag.get("href"):
                        player_link = link_tag.get("href")
                        print(f"Found {name} with link: {player_link}")
                        
                        # Now fetch the player's page
                        if player_link.startswith('/'):
                            full_url = f"http://www.ttcan.ca{player_link}"
                        elif player_link.startswith('http'):
                            full_url = player_link
                        else:
                            full_url = f"http://www.ttcan.ca/ratingSystem/{player_link}"
                        
                        print(f"Fetching: {full_url}")
                        player_resp = requests.get(full_url, timeout=15)
                        player_soup = BeautifulSoup(player_resp.content, "html.parser")
                        
                        # Print all tables and their structure
                        tables = player_soup.find_all("table")
                        print(f"Found {len(tables)} tables on the page")
                        
                        for i, table in enumerate(tables):
                            print(f"\n=== TABLE {i+1} ===")
                            rows = table.find_all("tr")
                            print(f"Table has {len(rows)} rows")
                            
                            for j, row in enumerate(rows[:5]):  # Show first 5 rows
                                cols = row.find_all(["td", "th"])
                                col_texts = [col.get_text(strip=True) for col in cols]
                                print(f"Row {j+1} ({len(cols)} cols): {col_texts}")
                        
                        return
    
    print(f"Player {player_name} not found")

if __name__ == "__main__":
    debug_player_page()