# Debug Player Script Instructions

The `debug_player.py` script is used to debug individual players and examine their page structure on the TTCAN website.

## How to Use

### 1. Basic Usage
The script will prompt you to enter a player name when you run it.

### 2. Running the Script
```bash
cd backend
source ../venv/bin/activate
python debug_player.py
```

When prompted, enter the player name (or part of it):
```
Enter the player name to debug: WANG Eugene
```

### 3. What the Script Does

1. **Searches for the player** across multiple pages of the TTCAN rating system
2. **Finds their profile link** and fetches their individual page
3. **Displays all tables** found on the player's page with their structure
4. **Shows the first 5 rows** of each table with column data

### 4. Example Output

```
Enter the player name to debug: WANG Eugene
Searching for WANG Eugene...
Found target player: WANG Eugene Zhen
Found WANG Eugene Zhen with link: ctta_ratings1.asp?Player_ID=7864&Period=403&
Fetching: http://www.ttcan.ca/ratingSystem/ctta_ratings1.asp?Player_ID=7864&Period=403&
Found 2 tables on the page

=== TABLE 1 ===
Table has 46 rows
Row 1 (226 cols): ['Period IDPeriodProvGenderRating403October 5, 2024ONM4084387June 6, 2023ONM4080377August 5, 2022ONM4064...', 'Period ID', 'Period', 'Prov', 'Gender', 'Rating', '403', 'October 5, 2024', 'ON', 'M', '4084', '387', 'June 6, 2023', 'ON', 'M', '4080', '377', 'August 5, 2022', 'ON', 'M', '4064', ...]
Row 2 (5 cols): ['Period ID', 'Period', 'Prov', 'Gender', 'Rating']
Row 3 (5 cols): ['403', 'October 5, 2024', 'ON', 'M', '4084']
Row 4 (5 cols): ['387', 'June 6, 2023', 'ON', 'M', '4080']
Row 5 (5 cols): ['377', 'August 5, 2022', 'ON', 'M', '4064']

=== TABLE 2 ===
Table has 45 rows
Row 1 (5 cols): ['Period ID', 'Period', 'Prov', 'Gender', 'Rating']
Row 2 (5 cols): ['403', 'October 5, 2024', 'ON', 'M', '4084']
Row 3 (5 cols): ['387', 'June 6, 2023', 'ON', 'M', '4080']
Row 4 (5 cols): ['377', 'August 5, 2022', 'ON', 'M', '4064']
Row 5 (5 cols): ['373', 'April 5, 2022', 'ON', 'M', '4111']
```

### 5. Troubleshooting

- **Player not found**: The script searches the first 50 pages. If a player isn't found, they might be on a later page or the name might be spelled differently
- **Partial name matching**: You can enter just part of the name (e.g., "WANG" will find all players with WANG in their name)
- **Case insensitive**: The search is case insensitive, so "wang eugene" will work the same as "WANG Eugene"
- **Extend search range**: Increase the page range if needed by changing `range(1, 50)` to a higher number

### 6. Use Cases

- **Debug history parsing issues**: See exactly what table structure exists for a player
- **Understand data format**: Check how dates, ratings, and other data are formatted
- **Verify player links**: Ensure the player links are working correctly
- **Test new parsing logic**: Before modifying the main scraper, test on specific players

### 7. Customizing the Script

To modify the output or search behavior, edit these parts:

```python
# Modify what information to display
print(f"Row {j+1} ({len(cols)} cols): {col_texts}")

# Adjust the number of rows shown per table
for j, row in enumerate(rows[:5]):  # Change 5 to show more/fewer rows

# Change search range
for page in range(1, 50):  # Increase 50 to search more pages
```

You can also call the function directly with a player name:
```python
debug_player_page("WANG Eugene")  # Skip the input prompt
```