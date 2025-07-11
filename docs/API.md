# API Documentation

## Backend API (Python Scraper)

### Functions

#### `scrape_all_ttcan_players()`
Scrapes all TTCAN player ratings from the official website.

**Returns:**
- `List[Dict[str, str]]`: List of player dictionaries

**Player Dictionary Structure:**
```python
{
    "Name": str,
    "Province": str,
    "Gender": str,
    "Rating": str,
    "Period": str,
    "Last Played": str
}
```

**Example:**
```python
players = scrape_all_ttcan_players()
print(f"Found {len(players)} players")
```

#### `write_to_sheet(players)`
Writes player data to Google Sheets.

**Parameters:**
- `players`: List of player dictionaries

**Returns:**
- `bool`: Success status

**Example:**
```python
success = write_to_sheet(players)
if success:
    print("Data uploaded successfully")
```

#### `validate_player_data(player)`
Validates player data structure and content.

**Parameters:**
- `player`: Player dictionary

**Returns:**
- `bool`: Validation result

**Validation Rules:**
- All required fields present
- Rating is numeric
- Name is not empty

### Configuration

#### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `TTCAN_BASE_URL` | TTCAN ratings URL | No | Official URL |
| `CATEGORY_CODE` | Category filter | No | "1" |
| `PERIOD_ISSUED` | Period filter | No | "412" |
| `SEX` | Gender filter | No | "F" |
| `GOOGLE_SHEET_ID` | Google Sheet ID | Yes | - |
| `GOOGLE_SHEET_NAME` | Sheet name | No | "Sheet1" |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | Service account JSON path | No | Default path |

#### Logging

The scraper logs to both console and file (`scraper.log`).

**Log Levels:**
- `INFO`: General information
- `WARNING`: Non-critical issues
- `ERROR`: Critical errors

## Frontend API (React App)

### Components

#### `App`
Main application component with data visualization.

**State:**
- `months`: Filter for activity period
- `data`: Raw player data
- `hist`: Histogram data
- `activePlayerCount`: Filtered player count
- `loading`: Loading state
- `error`: Error state

#### `ErrorBoundary`
Catches and displays React component errors.

### Utility Functions

#### `makeHistogram(data, binSize)`
Creates histogram data for visualization.

**Parameters:**
- `data`: Array of player objects
- `binSize`: Size of each histogram bin (default: 100)

**Returns:**
- Array of `{range, count}` objects

#### `isWithinLastNMonths(dateStr, months)`
Checks if a date is within the last N months.

**Parameters:**
- `dateStr`: Date string in MM/DD/YYYY format
- `months`: Number of months to check

**Returns:**
- `boolean`: Whether date is within range

#### `validatePlayerData(player)`
Validates player data on the frontend.

**Parameters:**
- `player`: Player object

**Returns:**
- `boolean`: Validation result

### Data Flow

1. **Initialization**: Load environment variables
2. **Data Fetch**: Fetch from Google Sheets API
3. **Data Validation**: Validate and clean data
4. **Data Processing**: Filter by date range
5. **Visualization**: Create histogram and display

### Error Handling

#### Error Types

- **Configuration Error**: Missing environment variables
- **Network Error**: API request failures
- **Data Error**: Invalid data format
- **Component Error**: React component crashes

#### Error Display

- Loading states during data fetch
- Error messages with retry options
- Fallback UI for missing data
- Error boundary for component crashes

## Google Sheets API

### Endpoints Used

#### Read Data
```
GET https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{SHEET_NAME}?key={API_KEY}
```

**Response:**
```json
{
  "values": [
    ["Name", "Province", "Gender", "Rating", "Period", "Last Played"],
    ["John Doe", "ON", "M", "2000", "2025-01", "01/15/2025"]
  ]
}
```

#### Write Data (Backend only)
Uses service account authentication to write data.

### Rate Limits

- Backend: 1 second delay between requests
- Frontend: Standard Google API limits
- Batch operations: 100 rows per batch

## Data Validation

### Backend Validation

```python
def validate_player_data(player):
    required_fields = ["Name", "Province", "Gender", "Rating", "Period", "Last Played"]
    
    for field in required_fields:
        if field not in player or not player[field].strip():
            return False
    
    # Rating must be numeric
    try:
        int(player["Rating"])
    except ValueError:
        return False
    
    return True
```

### Frontend Validation

```javascript
function validatePlayerData(player) {
  return (
    player.name &&
    typeof player.name === 'string' &&
    player.name.trim() !== '' &&
    !isNaN(player.rating) &&
    player.rating > 0 &&
    player.lastPlayed
  );
}
```