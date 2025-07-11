# Setup Guide

## Quick Start

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd ttcan_rating
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your actual values
   ```

3. **Backend setup**
   ```bash
   cd backend
   python -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

4. **Frontend setup**
   ```bash
   cd frontend
   npm install
   ```

## Detailed Setup

### Google Cloud Setup

1. **Create a Google Cloud Project**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing one

2. **Enable APIs**
   - Enable Google Sheets API
   - Enable Google Drive API

3. **Create Service Account**
   - Go to IAM & Admin → Service Accounts
   - Create a new service account
   - Download the JSON key file
   - Save it as `backend/service-account.json`

4. **Create API Key**
   - Go to APIs & Services → Credentials
   - Create API Key
   - Restrict to Google Sheets API (recommended)

### Google Sheets Setup

1. **Create a Google Sheet**
   - Go to [Google Sheets](https://sheets.google.com)
   - Create a new sheet
   - Copy the sheet ID from the URL

2. **Share the Sheet**
   - Share with the service account email
   - Give Editor permissions

3. **Add Header Row**
   ```
   Name | Province | Gender | Rating | Period | Last Played
   ```

### Environment Configuration

Create `.env` file in the root directory:

```bash
# Backend Configuration
TTCAN_BASE_URL=http://www.ttcan.ca/ratingSystem/ctta_ratings2.asp
CATEGORY_CODE=1
PERIOD_ISSUED=412
SEX=F
GOOGLE_SHEET_ID=your_sheet_id_here
GOOGLE_SHEET_NAME=Sheet1
GOOGLE_SERVICE_ACCOUNT_FILE=backend/service-account.json

# Frontend Configuration
REACT_APP_GOOGLE_SHEET_ID=your_sheet_id_here
REACT_APP_GOOGLE_SHEET_NAME=Sheet1
REACT_APP_GOOGLE_API_KEY=your_api_key_here
```

## Testing the Setup

### Test Backend
```bash
cd backend
python scrapping.py
```

### Test Frontend
```bash
cd frontend
npm start
```

## Troubleshooting

### Common Issues

1. **Permission Denied Error**
   - Check if service account has access to the sheet
   - Verify file paths in environment variables

2. **API Key Issues**
   - Ensure API key is valid
   - Check API restrictions

3. **Module Not Found**
   - Ensure virtual environment is activated
   - Run `pip install -r requirements.txt`

4. **Network Errors**
   - Check internet connection
   - Verify TTCAN website is accessible

### Debug Tips

1. **Enable Verbose Logging**
   ```python
   import logging
   logging.basicConfig(level=logging.DEBUG)
   ```

2. **Check Environment Variables**
   ```bash
   python -c "import os; print(os.getenv('GOOGLE_SHEET_ID'))"
   ```

3. **Test API Access**
   ```bash
   curl "https://sheets.googleapis.com/v4/spreadsheets/YOUR_SHEET_ID/values/Sheet1?key=YOUR_API_KEY"
   ```