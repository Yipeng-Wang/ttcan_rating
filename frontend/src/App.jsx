import React, { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

// ====== CONFIGURATION ======
const SHEET_ID = process.env.REACT_APP_GOOGLE_SHEET_ID;
const SHEET_NAME = process.env.REACT_APP_GOOGLE_SHEET_NAME || "Sheet1";
const API_KEY = process.env.REACT_APP_GOOGLE_API_KEY;
const SHEET_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}?key=${API_KEY}`;

// ====== VALIDATION ======
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

// ====== HISTOGRAM UTIL ======
function makeHistogram(data, binSize = 100) {
  if (data.length === 0) return [];
  
  try {
    const ratings = data.map(d => d.rating).filter(r => !isNaN(r) && r > 0);
    if (ratings.length === 0) return [];
    
    const min = Math.floor(Math.min(...ratings) / binSize) * binSize;
    const max = Math.ceil(Math.max(...ratings) / binSize) * binSize;
    const bins = {};
    
    for (let i = min; i < max; i += binSize) {
      bins[`${i}-${i + binSize - 1}`] = 0;
    }
    
    for (let r of ratings) {
      const binStart = Math.floor(r / binSize) * binSize;
      const binKey = `${binStart}-${binStart + binSize - 1}`;
      if (bins[binKey] !== undefined) {
        bins[binKey]++;
      }
    }
    
    return Object.entries(bins).map(([range, count]) => ({ range, count }));
  } catch (error) {
    console.error('Error creating histogram:', error);
    return [];
  }
}

// ====== DATE FILTER ======
function isWithinLastNMonths(dateStr, months) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  
  try {
    const [month, day, year] = dateStr.split(/[\/\-]/).map(Number);
    if (!year || !month || !day || year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
      return false;
    }
    
    const lastPlayed = new Date(year, month - 1, day);
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
    
    return lastPlayed >= cutoff && lastPlayed <= now;
  } catch (error) {
    console.error('Error parsing date:', dateStr, error);
    return false;
  }
}

// ====== ERROR BOUNDARY ======
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, fontFamily: "sans-serif" }}>
          <h2>Something went wrong</h2>
          <p>There was an error loading the application. Please refresh the page.</p>
          <details style={{ marginTop: 16 }}>
            <summary>Error details</summary>
            <pre style={{ marginTop: 8, padding: 8, backgroundColor: '#f5f5f5', borderRadius: 4 }}>
              {this.state.error?.toString()}
            </pre>
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}

// ====== MAIN COMPONENT ======
function App() {
  const [months, setMonths] = useState(6);
  const [data, setData] = useState([]);
  const [hist, setHist] = useState([]);
  const [activePlayerCount, setActivePlayerCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Validate configuration
  useEffect(() => {
    if (!SHEET_ID || !API_KEY) {
      setError('Missing configuration. Please check environment variables.');
      setLoading(false);
      return;
    }
  }, []);

  // Fetch data once on mount
  useEffect(() => {
    if (!SHEET_ID || !API_KEY) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(SHEET_URL);
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const json = await response.json();
        
        if (!json.values || !Array.isArray(json.values)) {
          throw new Error('Invalid data format from Google Sheets');
        }
        
        const rows = json.values.slice(1); // skip header
        const parsed = rows
          .map(cols => {
            if (!cols || cols.length < 6) return null;
            
            const player = {
              name: cols[0] || '',
              rating: parseInt(cols[3], 10),
              lastPlayed: cols[5] || '',
            };
            
            return validatePlayerData(player) ? player : null;
          })
          .filter(player => player !== null);
        
        setData(parsed);
        console.log(`Loaded ${parsed.length} valid players`);
        
      } catch (err) {
        console.error('Error fetching data:', err);
        setError(`Failed to load data: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [SHEET_URL]);

  // Re-filter and update histogram/count when data or months changes
  useEffect(() => {
    try {
      // If months is empty or 0, show all data
      const monthsValue = months === '' || months === '0' ? 1000 : Number(months);
      const filtered = data.filter(x => isWithinLastNMonths(x.lastPlayed, monthsValue));
      setActivePlayerCount(filtered.length);
      setHist(makeHistogram(filtered, 100));
    } catch (err) {
      console.error('Error filtering data:', err);
      setError('Error processing data');
    }
  }, [months, data]);

  const handleMonthsChange = (e) => {
    const value = e.target.value;
    
    // Allow empty input or valid numbers
    if (value === '' || value === '0') {
      setMonths(value);
    } else {
      const numValue = Number(value);
      if (!isNaN(numValue) && numValue >= 1 && numValue <= 60) {
        setMonths(numValue);
      }
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 32, fontFamily: "sans-serif", textAlign: "center" }}>
        <h2>Loading TTCAN Rating Data...</h2>
        <p>Please wait while we fetch the latest data.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 32, fontFamily: "sans-serif" }}>
        <h2>Error Loading Data</h2>
        <p style={{ color: 'red' }}>{error}</p>
        <button onClick={() => window.location.reload()} style={{ marginTop: 16, padding: '8px 16px' }}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 32, fontFamily: "sans-serif" }}>
      <h2>TTCAN Woman Rating Distribution</h2>
      
      <div style={{ marginBottom: 20 }}>
        <label>
          Show players active in last&nbsp;
          <input
            type="number"
            min={1}
            max={60}
            value={months}
            onChange={handleMonthsChange}
            style={{ width: 60, padding: 4 }}
          />
          &nbsp;month(s)
        </label>
      </div>
      
      <div style={{ margin: "20px 0", fontWeight: "bold" }}>
        Total active players: {activePlayerCount}
      </div>
      
      {hist.length > 0 ? (
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={hist} style={{ marginTop: 32 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="range" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill="#8884d8" />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ marginTop: 32, padding: 20, border: '1px solid #ccc', borderRadius: 4 }}>
          <p>No data available for the selected time period.</p>
          <p>Try increasing the number of months or check if data is available in the Google Sheet.</p>
        </div>
      )}
    </div>
  );
}

export default function AppWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}