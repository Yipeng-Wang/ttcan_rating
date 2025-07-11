# TTCAN Rating Analysis

A comprehensive tool for scraping and analyzing TTCAN (Table Tennis Canada) player ratings with interactive visualizations.

## Features

- **Data Scraping**: Automated scraping of TTCAN player ratings from official website
- **Data Visualization**: Interactive histogram showing rating distribution
- **Filtering**: Filter players by activity period (last N months)
- **Real-time Updates**: Fetch latest data from Google Sheets
- **Error Handling**: Robust error handling and validation
- **Security**: Environment-based configuration for sensitive data

## Project Structure

```
ttcan_rating/
├── backend/           # Python web scraper
│   ├── scrapping.py   # Main scraper script
│   └── requirements.txt
├── frontend/          # React visualization app
│   ├── src/
│   │   └── App.jsx    # Main React component
│   └── package.json
├── shared/            # Shared utilities
│   └── config.py      # Configuration management
├── docs/              # Documentation
└── .env.example       # Environment template
```

## Setup Instructions

### Prerequisites

- Python 3.8+
- Node.js 14+
- Google Sheets API access
- Google Cloud Service Account

### Backend Setup

1. Navigate to backend directory:
   ```bash
   cd backend
   ```

2. Create and activate virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Set up environment variables (see Configuration section)

5. Run the scraper:
   ```bash
   python scrapping.py
   ```

### Frontend Setup

1. Navigate to frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables (see Configuration section)

4. Start development server:
   ```bash
   npm start
   ```

## Configuration

### Environment Variables

Create a `.env` file in the root directory based on `.env.example`:

```bash
# Backend Configuration
TTCAN_BASE_URL=http://www.ttcan.ca/ratingSystem/ctta_ratings2.asp
CATEGORY_CODE=1
PERIOD_ISSUED=412
SEX=F
GOOGLE_SHEET_ID=your_google_sheet_id_here
GOOGLE_SHEET_NAME=Sheet1
GOOGLE_SERVICE_ACCOUNT_FILE=path/to/service-account.json

# Frontend Configuration
REACT_APP_GOOGLE_SHEET_ID=your_google_sheet_id_here
REACT_APP_GOOGLE_SHEET_NAME=Sheet1
REACT_APP_GOOGLE_API_KEY=your_google_api_key_here
```

### Google Sheets Setup

1. Create a Google Sheet to store the data
2. Enable Google Sheets API in Google Cloud Console
3. Create a Service Account and download the JSON key
4. Share the Google Sheet with the service account email
5. Get a Google API key for the frontend

## Usage

### Running the Scraper

The scraper fetches all TTCAN player ratings and stores them in Google Sheets:

```bash
cd backend
python scrapping.py
```

Features:
- Automatic pagination through all rating pages
- Retry logic for failed requests
- Data validation and cleaning
- Batch uploads to Google Sheets
- Comprehensive logging

### Using the Frontend

The React app provides an interactive visualization:

1. Start the development server: `npm start`
2. Open http://localhost:3000
3. Use the month filter to adjust the time period
4. View the rating distribution histogram

## Data Flow

1. **Scraper** → Fetches data from TTCAN website
2. **Scraper** → Validates and cleans data
3. **Scraper** → Uploads to Google Sheets
4. **Frontend** → Fetches data from Google Sheets
5. **Frontend** → Filters and visualizes data

## Error Handling

### Backend
- Network request retries with exponential backoff
- Data validation before processing
- Comprehensive logging to files and console
- Graceful handling of API rate limits

### Frontend
- Error boundary for React component crashes
- Loading states and error messages
- Input validation for user controls
- Fallback UI for missing data

## Security

- Environment variables for sensitive data
- Service account authentication
- API key rotation support
- Comprehensive .gitignore for secrets

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is for educational and analysis purposes only.
