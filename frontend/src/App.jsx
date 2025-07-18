import React, { useEffect, useState, useMemo, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
// ====== CONFIGURATION ======
const SHEET_ID = process.env.REACT_APP_GOOGLE_SHEET_ID;
const SHEET_NAME = process.env.REACT_APP_GOOGLE_SHEET_NAME || "Sheet1";
const API_KEY = process.env.REACT_APP_GOOGLE_API_KEY;
const SHEET_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}?key=${API_KEY}`;
const HISTORY_SHEET_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/RatingHistory?key=${API_KEY}`;

function validatePlayerData(player) {
  return (
    player.name &&
    typeof player.name === 'string' &&
    player.name.trim() !== '' &&
    !isNaN(player.rating) &&
    player.rating > 0 &&
    player.lastPlayed &&
    typeof player.gender === 'string' && // Gender can be empty string
    (player.gender === 'F' || player.gender === 'M' || player.gender === '')
  );
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

const useWindowSize = () => {
  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return windowSize;
};

const isMobile = (width) => width <= 768;
const isTablet = (width) => width > 768 && width <= 1024;

// Memoized Rating History Chart Component for better performance
const RatingHistoryChart = React.memo(({ 
  playerHistory, 
  playerName, 
  windowSize, 
  historyLoading,
  comparePlayerHistory,
  comparePlayerName,
  compareHistoryLoading,
  startCompareYear,
  startCompareMonth
}) => {
  // Memoize chart configuration to prevent recreation on every render
  const chartConfig = useMemo(() => ({
    margin: isMobile(windowSize.width) ? {
      top: 10,
      right: 10,
      left: 5,
      bottom: 60,
    } : {
      top: 5,
      right: 30,
      left: 20,
      bottom: 5,
    },
    height: isMobile(windowSize.width) ? "320px" : "450px"
  }), [windowSize.width]);

  // Merge player histories into a single dataset for the chart
  const chartData = useMemo(() => {
    // If no main player is selected, return empty data
    if (!playerName || playerHistory.length === 0) {
      return [];
    }
    
    if (comparePlayerHistory.length === 0) {
      // Single player mode - apply date filtering if specified
      let filteredHistory = playerHistory;
      if (startCompareYear) {
        const month = startCompareMonth || '01'; // Default to January if month not specified
        const startDate = new Date(parseInt(startCompareYear), parseInt(month) - 1, 1);
        
        // Get last known rating before the filter date for extrapolation
        const parseDate = (period) => {
          if (!period) return new Date(0);
          if (/^\d{4}-\d{2}$/.test(period)) return new Date(period + '-01');
          if (/^\d+$/.test(period)) return new Date(parseInt(period) * 86400000);
          const date = new Date(period);
          return isNaN(date.getTime()) ? new Date(0) : date;
        };
        
        const beforeFilterEntries = playerHistory.filter(entry => parseDate(entry.period) < startDate);
        const lastKnownRating = beforeFilterEntries.length > 0 ? beforeFilterEntries[beforeFilterEntries.length - 1].rating : null;
        
        filteredHistory = playerHistory.filter(entry => {
          const entryDate = parseDate(entry.period);
          return entryDate >= startDate;
        });
        
        // If no data in filtered period but we have a last known rating, create a data point
        if (filteredHistory.length === 0 && lastKnownRating !== null) {
          filteredHistory = [{
            period: `${startCompareYear}-${month.padStart(2, '0')}`,
            rating: lastKnownRating,
            lastPlayed: 'Extrapolated'
          }];
        }
      }
      return filteredHistory.map(entry => ({
        period: entry.period,
        [playerName]: entry.rating
      }));
    }

    // Comparison mode - merge both player datasets
    const allPeriods = new Set();
    playerHistory.forEach(entry => allPeriods.add(entry.period));
    comparePlayerHistory.forEach(entry => allPeriods.add(entry.period));
    
    // Get last known ratings before filtering for extrapolation
    const getLastKnownRating = (history, beforeDate) => {
      const parseDate = (period) => {
        if (!period) return new Date(0);
        if (/^\d{4}-\d{2}$/.test(period)) return new Date(period + '-01');
        if (/^\d+$/.test(period)) return new Date(parseInt(period) * 86400000);
        const date = new Date(period);
        return isNaN(date.getTime()) ? new Date(0) : date;
      };
      
      const beforeFilterEntries = history.filter(entry => parseDate(entry.period) < beforeDate);
      return beforeFilterEntries.length > 0 ? beforeFilterEntries[beforeFilterEntries.length - 1].rating : null;
    };

    // Filter by start date if specified
    let filteredPeriods = Array.from(allPeriods);
    let startDate = null;
    let lastPlayer1Rating = null;
    let lastPlayer2Rating = null;
    
    if (startCompareYear) {
      const month = startCompareMonth || '01'; // Default to January if month not specified
      startDate = new Date(parseInt(startCompareYear), parseInt(month) - 1, 1);
      
      // Get last known ratings before the filter date for extrapolation
      lastPlayer1Rating = getLastKnownRating(playerHistory, startDate);
      lastPlayer2Rating = getLastKnownRating(comparePlayerHistory, startDate);
      
      filteredPeriods = filteredPeriods.filter(period => {
        // Parse period to date for comparison
        const parseDate = (period) => {
          if (!period) return new Date(0);
          
          // If it looks like YYYY-MM format
          if (/^\d{4}-\d{2}$/.test(period)) {
            return new Date(period + '-01');
          }
          
          // If it's a numeric period ID, treat as is for now
          if (/^\d+$/.test(period)) {
            return new Date(parseInt(period) * 86400000);
          }
          
          // Try to parse as date directly
          const date = new Date(period);
          return isNaN(date.getTime()) ? new Date(0) : date;
        };
        
        const entryDate = parseDate(period);
        return entryDate >= startDate;
      });
    }

    // Sort periods chronologically
    filteredPeriods.sort((a, b) => {
      const parseDate = (period) => {
        if (/^\d{4}-\d{2}$/.test(period)) {
          return new Date(period + '-01');
        }
        if (/^\d+$/.test(period)) {
          return new Date(parseInt(period) * 86400000);
        }
        return new Date(period);
      };
      
      const dateA = parseDate(a);
      const dateB = parseDate(b);
      return dateA.getTime() - dateB.getTime();
    });

    // Create merged dataset with interpolation for missing values
    const mergedData = [];
    let currentPlayer1Rating = lastPlayer1Rating; // Use pre-calculated last known rating
    let currentPlayer2Rating = lastPlayer2Rating; // Use pre-calculated last known rating
    
    for (let i = 0; i < filteredPeriods.length; i++) {
      const period = filteredPeriods[i];
      const dataPoint = { period };
      
      // Handle player 1 data
      const player1Entry = playerHistory.find(entry => entry.period === period);
      if (player1Entry) {
        currentPlayer1Rating = player1Entry.rating;
        dataPoint[playerName] = player1Entry.rating;
      } else if (currentPlayer1Rating !== null) {
        // Use previous data point value for missing data (including extrapolated last known rating)
        dataPoint[playerName] = currentPlayer1Rating;
      }
      
      // Handle player 2 data
      const player2Entry = comparePlayerHistory.find(entry => entry.period === period);
      if (player2Entry) {
        currentPlayer2Rating = player2Entry.rating;
        dataPoint[comparePlayerName] = player2Entry.rating;
      } else if (currentPlayer2Rating !== null) {
        // Use previous data point value for missing data (including extrapolated last known rating)
        dataPoint[comparePlayerName] = currentPlayer2Rating;
      }
      
      mergedData.push(dataPoint);
    }
    
    
    return mergedData;
  }, [playerHistory, comparePlayerHistory, playerName, comparePlayerName, startCompareYear, startCompareMonth]);

  // Memoize tick formatter to prevent function recreation
  const tickFormatter = useCallback((value) => {
    if (!value) return '';
    
    // If it looks like YYYY-MM format
    if (/^\d{4}-\d{2}$/.test(value)) {
      const [year, month] = value.split('-');
      const date = new Date(parseInt(year), parseInt(month) - 1);
      // Mobile: shorter format
      if (isMobile(windowSize.width)) {
        return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      }
      return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }
    
    // If it's a numeric period
    if (/^\d+$/.test(value)) {
      return isMobile(windowSize.width) ? `P${value}` : `Period ${value}`;
    }
    
    return value;
  }, [windowSize.width]);

  // Memoize tooltip formatter
  const tooltipLabelFormatter = useCallback((value) => {
    if (!value) return 'Period: Unknown';
    
    if (/^\d{4}-\d{2}$/.test(value)) {
      const [year, month] = value.split('-');
      const date = new Date(parseInt(year), parseInt(month) - 1);
      return `Period: ${date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
    }
    
    if (/^\d+$/.test(value)) {
      return `Period: ${value}`;
    }
    
    return `Period: ${value}`;
  }, []);

  if (historyLoading || compareHistoryLoading) {
    return (
      <div style={{ 
        textAlign: "center", 
        padding: "40px",
        color: "#1976D2",
        fontSize: isMobile(windowSize.width) ? "1em" : "1.1em"
      }}>
        Loading rating history{compareHistoryLoading ? " for comparison" : ""}...
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div style={{
        textAlign: "center",
        padding: "40px",
        color: "#757575",
        fontSize: isMobile(windowSize.width) ? "1em" : "1.1em"
      }}>
        No rating history available{comparePlayerName ? ` for ${playerName} or ${comparePlayerName}` : ` for ${playerName}`}
      </div>
    );
  }

  return (
    <div style={{ 
      height: chartConfig.height,
      width: "100%",
      position: 'relative',
      overflow: 'visible'
    }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={chartConfig.margin}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis 
            dataKey="period"
            tick={{ 
              fontSize: isMobile(windowSize.width) ? 8 : 12,
              fill: '#1976D2'
            }}
            interval={isMobile(windowSize.width) ? Math.max(0, Math.floor(chartData.length / 3)) : Math.max(0, Math.floor(chartData.length / 8))}
            angle={isMobile(windowSize.width) ? -50 : 0}
            textAnchor={isMobile(windowSize.width) ? 'end' : 'middle'}
            height={isMobile(windowSize.width) ? 70 : 30}
            axisLine={{ stroke: '#1976D2', strokeWidth: 2 }}
            tickLine={{ stroke: '#1976D2', strokeWidth: 1 }}
            tickFormatter={tickFormatter}
          />
          <YAxis 
            tick={{ 
              fontSize: isMobile(windowSize.width) ? 9 : 12,
              fill: '#1976D2'
            }}
            domain={['dataMin - 50', 'dataMax + 50']}
            width={isMobile(windowSize.width) ? 45 : 60}
            axisLine={{ stroke: '#1976D2', strokeWidth: 2 }}
            tickLine={{ stroke: '#1976D2', strokeWidth: 1 }}
            label={isMobile(windowSize.width) ? undefined : { 
              value: 'Rating', 
              angle: -90, 
              position: 'insideLeft',
              style: { textAnchor: 'middle', fill: '#1976D2', fontWeight: 'bold' }
            }}
          />
          <Tooltip 
            labelFormatter={tooltipLabelFormatter}
            content={({ active, payload, label }) => {
              if (active && payload && payload.length) {
                return (
                  <div style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.98)',
                    border: '2px solid #2196F3',
                    borderRadius: isMobile(windowSize.width) ? '12px' : '8px',
                    fontSize: isMobile(windowSize.width) ? '13px' : '14px',
                    fontWeight: 'bold',
                    boxShadow: '0 4px 12px rgba(33, 150, 243, 0.3)',
                    padding: isMobile(windowSize.width) ? '12px' : '8px',
                    minWidth: isMobile(windowSize.width) ? '120px' : 'auto'
                  }}>
                    <p style={{ 
                      color: '#1976D2', 
                      fontWeight: 'bold', 
                      margin: '0 0 8px 0' 
                    }}>
                      {tooltipLabelFormatter(label)}
                    </p>
                    {payload.map((entry, index) => {
                      // Extract second name (first word after first space)
                      const nameParts = entry.dataKey.split(' ');
                      const secondName = nameParts.length > 1 ? nameParts[1] : nameParts[0];
                      
                      return (
                        <p key={index} style={{ 
                          color: entry.color, 
                          margin: '4px 0',
                          fontWeight: 'bold'
                        }}>
                          <span style={{ color: entry.color }}>●</span> {secondName}: {entry.value}
                        </p>
                      );
                    })}
                  </div>
                );
              }
              return null;
            }}
            cursor={{
              stroke: '#2196F3',
              strokeWidth: 2,
              strokeDasharray: '5 5'
            }}
          />
          <Legend />
          <Line 
            type="monotone" 
            dataKey={playerName}
            stroke="#2196F3"
            strokeWidth={isMobile(windowSize.width) ? 3 : 2}
            dot={{
              fill: '#1976D2',
              strokeWidth: 2,
              stroke: '#fff',
              r: isMobile(windowSize.width) ? 5 : 4
            }}
            activeDot={{
              r: isMobile(windowSize.width) ? 8 : 6,
              fill: '#FF6B35',
              stroke: '#fff',
              strokeWidth: 2,
              drop: true
            }}
            connectNulls={false}
            name={playerName}
          />
          {comparePlayerName && comparePlayerHistory.length > 0 && (
            <Line 
              type="monotone" 
              dataKey={comparePlayerName}
              stroke="#FF6B35"
              strokeWidth={isMobile(windowSize.width) ? 3 : 2}
              dot={{
                fill: '#FF6B35',
                strokeWidth: 2,
                stroke: '#fff',
                r: isMobile(windowSize.width) ? 5 : 4
              }}
              activeDot={{
                r: isMobile(windowSize.width) ? 8 : 6,
                fill: '#2196F3',
                stroke: '#fff',
                strokeWidth: 2,
                drop: true
              }}
              connectNulls={false}
              name={comparePlayerName}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});

function App() {
  const [months, setMonths] = useState('');
  const [data, setData] = useState([]);
  const windowSize = useWindowSize();
  const [activePlayerCount, setActivePlayerCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [playerName, setPlayerName] = useState('');
  const [filteredNames, setFilteredNames] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedGender, setSelectedGender] = useState('all');
  const [genderCounts, setGenderCounts] = useState({ F: 0, M: 0 });
  const [selectedAge, setSelectedAge] = useState('all');
  const [selectedProvince, setSelectedProvince] = useState('all');
  const [provinceCounts, setProvinceCounts] = useState({});
  const [topPlayers, setTopPlayers] = useState([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  
  // Rating history and comparison states
  const [playerHistory, setPlayerHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyCache, setHistoryCache] = useState(new Map());
  const [lastHistoryFetch, setLastHistoryFetch] = useState(0);
  
  // Comparison states
  const [comparePlayerName, setComparePlayerName] = useState('');
  const [comparePlayerHistory, setComparePlayerHistory] = useState([]);
  const [compareHistoryLoading, setCompareHistoryLoading] = useState(false);
  const [startCompareYear, setStartCompareYear] = useState('');
  const [startCompareMonth, setStartCompareMonth] = useState('');
  const [showComparison, setShowComparison] = useState(false);
  
  // Compare autocomplete states
  const [compareFilteredNames, setCompareFilteredNames] = useState([]);
  const [showCompareSuggestions, setShowCompareSuggestions] = useState(false);
  const [selectedCompareSuggestionIndex, setSelectedCompareSuggestionIndex] = useState(-1);

  // Calculate the earliest year from both player histories
  const earliestYear = useMemo(() => {
    const getAllPeriods = () => {
      const periods = [];
      playerHistory.forEach(entry => periods.push(entry.period));
      comparePlayerHistory.forEach(entry => periods.push(entry.period));
      return periods;
    };
    
    const parseDate = (period) => {
      if (!period) return new Date(0);
      if (/^\d{4}-\d{2}$/.test(period)) return new Date(period + '-01');
      if (/^\d+$/.test(period)) return new Date(parseInt(period) * 86400000);
      const date = new Date(period);
      return isNaN(date.getTime()) ? new Date(0) : date;
    };
    
    const allPeriods = getAllPeriods();
    if (allPeriods.length === 0) return 2010;
    
    const earliestDate = allPeriods
      .map(period => parseDate(period))
      .filter(date => date.getTime() > 0)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    
    return earliestDate ? earliestDate.getFullYear() : 2010;
  }, [playerHistory, comparePlayerHistory]);

  useEffect(() => {
    if (!SHEET_ID || !API_KEY) {
      setError('Missing configuration. Please check environment variables.');
      setLoading(false);
      return;
    }
  }, []);

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
              province: cols[1] || '',
              gender: cols[2] || '',
              rating: parseInt(cols[3], 10),
              period: cols[4] || '',
              lastPlayed: cols[5] || '',
              age: cols[6] || '',
            };
            
            return validatePlayerData(player) ? player : null;
          })
          .filter(player => player !== null);
        
        setData(parsed);
        
        // Calculate gender distribution
        const genderCount = parsed.reduce((acc, player) => {
          const gender = player.gender || 'unknown';
          acc[gender] = (acc[gender] || 0) + 1;
          return acc;
        }, {});
        setGenderCounts(genderCount);
        
        // Calculate province distribution
        const provinceCount = parsed.reduce((acc, player) => {
          acc[player.province] = (acc[player.province] || 0) + 1;
          return acc;
        }, {});
        setProvinceCounts(provinceCount);
        
        console.log(`Loaded ${parsed.length} valid players (${genderCount.F || 0} Female, ${genderCount.M || 0} Male, ${genderCount.unknown || 0} Unknown)`);
        
      } catch (err) {
        console.error('Error fetching data:', err);
        setError(`Failed to load data: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [SHEET_URL]);

  // Memoize filtered data to avoid re-filtering on every render
  const filteredData = useMemo(() => {
    try {
      // If months is empty or 0, show all data
      const monthsValue = months === '' || months === '0' ? 1000 : Number(months);
      
      return data.filter(player => {
        // Combined filtering in single pass
        if (!isWithinLastNMonths(player.lastPlayed, monthsValue)) return false;
        
        if (selectedGender !== 'all' && player.gender !== selectedGender) return false;
        
        if (selectedAge !== 'all') {
          const age = parseInt(player.age);
          if (isNaN(age) || age === 0) return false;
          
          switch (selectedAge) {
            case 'u9': if (age > 9) return false; break;
            case 'u10': if (age > 10) return false; break;
            case 'u11': if (age > 11) return false; break;
            case 'u12': if (age > 12) return false; break;
            case 'u13': if (age > 13) return false; break;
            case 'u14': if (age > 14) return false; break;
            case 'u15': if (age > 15) return false; break;
            case 'u17': if (age > 17) return false; break;
            case 'u19': if (age > 19) return false; break;
          }
        }
        
        if (selectedProvince !== 'all' && player.province !== selectedProvince) return false;
        
        return true;
      });
    } catch (err) {
      console.error('Error filtering data:', err);
      return [];
    }
  }, [data, months, selectedGender, selectedAge, selectedProvince]);

  useEffect(() => {
    try {
      setActivePlayerCount(filteredData.length);
      
      // Update top 100 players list
      const sortedPlayers = filteredData
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 100)
        .map((player, index) => ({
          ...player,
          rank: index + 1
        }));
      setTopPlayers(sortedPlayers);
      
      // Auto-scroll to player if they're in the top 100
      if (playerName && sortedPlayers.some(p => p.name === playerName)) {
        setTimeout(() => {
          const playerElement = document.querySelector(`[data-player-name="${playerName}"]`);
          if (playerElement) {
            playerElement.scrollIntoView({
              behavior: 'smooth',
              block: 'center'
            });
          }
        }, 100);
      }
    } catch (err) {
      console.error('Error filtering data:', err);
      setError('Error processing data');
    }
  }, [filteredData, playerName]);

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

  // Memoize autocomplete suggestions
  const autocompleteData = useMemo(() => {
    if (!data || data.length === 0) return [];
    
    return data
      .filter(player => selectedGender === 'all' || player.gender === selectedGender)
      .sort((a, b) => {
        // Pre-sort by rating first, then by last played date
        if (a.rating !== b.rating) {
          return b.rating - a.rating;
        }
        
        const parseDate = (dateStr) => {
          if (!dateStr) return new Date(0);
          const parts = dateStr.split(/[\/\-]/);
          if (parts.length === 3) {
            return new Date(parts[2], parts[0] - 1, parts[1]);
          }
          return new Date(dateStr);
        };
        
        const dateA = parseDate(a.lastPlayed);
        const dateB = parseDate(b.lastPlayed);
        
        return dateB.getTime() - dateA.getTime();
      })
      .map(player => player.name);
  }, [data, selectedGender]);

  const handleNameChange = (e) => {
    const value = e.target.value;
    setPlayerName(value);
    setSelectedSuggestionIndex(-1);
    
    if (value.length > 0) {
      // Fast string matching on pre-sorted data
      const filtered = autocompleteData
        .filter(name => name.toLowerCase().includes(value.toLowerCase()))
        .slice(0, 10);
      
      setFilteredNames(filtered);
      setShowSuggestions(true);
    } else {
      // When name is cleared, reset all filters to their default values
      setFilteredNames([]);
      setShowSuggestions(false);
      setSelectedSuggestionIndex(-1);
      
      // Clear all filter values
      setSelectedProvince('all');
      setSelectedGender('all');
      setSelectedAge('all');
      
      // Hide the rating history section
      setShowHistory(false);
      setPlayerHistory([]);
      
      // Clear comparison data
      setComparePlayerName('');
      setComparePlayerHistory([]);
      setShowComparison(false);
      setStartCompareYear('');
      setStartCompareMonth('');
    }
  };

  const handleKeyDown = (e) => {
    if (!showSuggestions || filteredNames.length === 0) return;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSuggestionIndex(prev => {
        const newIndex = prev < filteredNames.length - 1 ? prev + 1 : 0;
        // Scroll the selected item into view
        setTimeout(() => {
          const suggestionContainer = document.querySelector('.autocomplete-suggestions');
          const selectedItem = suggestionContainer?.children[newIndex];
          if (selectedItem && suggestionContainer) {
            selectedItem.scrollIntoView({
              behavior: 'smooth',
              block: 'nearest'
            });
          }
        }, 0);
        return newIndex;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSuggestionIndex(prev => {
        const newIndex = prev > 0 ? prev - 1 : filteredNames.length - 1;
        // Scroll the selected item into view
        setTimeout(() => {
          const suggestionContainer = document.querySelector('.autocomplete-suggestions');
          const selectedItem = suggestionContainer?.children[newIndex];
          if (selectedItem && suggestionContainer) {
            selectedItem.scrollIntoView({
              behavior: 'smooth',
              block: 'nearest'
            });
          }
        }, 0);
        return newIndex;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedSuggestionIndex >= 0 && selectedSuggestionIndex < filteredNames.length) {
        handleNameSelect(filteredNames[selectedSuggestionIndex]);
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setSelectedSuggestionIndex(-1);
    }
  };

  const handleNameSelect = (name) => {
    setPlayerName(name);
    setShowSuggestions(false);
    setSelectedSuggestionIndex(-1);
    
    // Find the selected player in the full dataset
    const selectedPlayer = data.find(p => p.name === name);
    
    if (selectedPlayer) {
      // Auto-fill filter values with player's information
      setSelectedProvince(selectedPlayer.province || 'all');
      setSelectedGender(selectedPlayer.gender || 'all');
      
      // Auto-fill age filter based on player's age
      const age = parseInt(selectedPlayer.age);
      if (!isNaN(age) && age > 0) {
        let ageCategory = 'all';
        if (age <= 9) ageCategory = 'u9';
        else if (age <= 10) ageCategory = 'u10';
        else if (age <= 11) ageCategory = 'u11';
        else if (age <= 12) ageCategory = 'u12';
        else if (age <= 13) ageCategory = 'u13';
        else if (age <= 14) ageCategory = 'u14';
        else if (age <= 15) ageCategory = 'u15';
        else if (age <= 17) ageCategory = 'u17';
        else if (age <= 19) ageCategory = 'u19';
        
        setSelectedAge(ageCategory);
      } else {
        setSelectedAge('all');
      }
    }
    
    // Fetch rating history for the selected player
    fetchPlayerHistory(name);
    
    // The useEffect will handle recalculating player info with the new filter values
  };

  // Memoize comparison autocomplete data (all players, no restrictions)
  const compareAutocompleteData = useMemo(() => {
    if (!data || data.length === 0) return [];
    
    return data
      .sort((a, b) => {
        if (a.rating !== b.rating) {
          return b.rating - a.rating;
        }
        
        const parseDate = (dateStr) => {
          if (!dateStr) return new Date(0);
          const parts = dateStr.split(/[\/\-]/);
          if (parts.length === 3) {
            return new Date(parts[2], parts[0] - 1, parts[1]);
          }
          return new Date(dateStr);
        };
        
        const dateA = parseDate(a.lastPlayed);
        const dateB = parseDate(b.lastPlayed);
        
        return dateB.getTime() - dateA.getTime();
      })
      .map(player => player.name);
  }, [data]);

  // Compare player autocomplete handlers
  const handleCompareNameChange = (e) => {
    const value = e.target.value;
    setComparePlayerName(value);
    setSelectedCompareSuggestionIndex(-1);
    
    if (value.length > 0) {
      // Fast string matching on pre-sorted data
      const filtered = compareAutocompleteData
        .filter(name => name.toLowerCase().includes(value.toLowerCase()))
        .slice(0, 10);
      
      setCompareFilteredNames(filtered);
      setShowCompareSuggestions(true);
    } else {
      setCompareFilteredNames([]);
      setShowCompareSuggestions(false);
      setSelectedCompareSuggestionIndex(-1);
      setComparePlayerHistory([]);
      setShowComparison(false);
    }
  };

  const handleCompareKeyDown = (e) => {
    if (!showCompareSuggestions || compareFilteredNames.length === 0) return;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedCompareSuggestionIndex(prev => {
        const newIndex = prev < compareFilteredNames.length - 1 ? prev + 1 : 0;
        return newIndex;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedCompareSuggestionIndex(prev => {
        const newIndex = prev > 0 ? prev - 1 : compareFilteredNames.length - 1;
        return newIndex;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedCompareSuggestionIndex >= 0 && selectedCompareSuggestionIndex < compareFilteredNames.length) {
        handleCompareNameSelect(compareFilteredNames[selectedCompareSuggestionIndex]);
      }
    } else if (e.key === 'Escape') {
      setShowCompareSuggestions(false);
      setSelectedCompareSuggestionIndex(-1);
    }
  };

  const handleCompareNameSelect = (name) => {
    setComparePlayerName(name);
    setShowCompareSuggestions(false);
    setSelectedCompareSuggestionIndex(-1);
    
    // Fetch comparison player history
    fetchComparePlayerHistory(name);
  };

  // Fetch player rating history with performance optimizations
  const fetchPlayerHistory = async (selectedPlayerName) => {
    if (!selectedPlayerName || !selectedPlayerName.trim()) return;
    
    setHistoryLoading(true);
    setShowHistory(true);
    
    try {
      // Check cache first (10-minute expiration for better mobile performance)
      const cacheKey = selectedPlayerName.toLowerCase();
      const now = Date.now();
      if (historyCache.has(cacheKey) && (now - lastHistoryFetch) < 10 * 60 * 1000) {
        const cachedData = historyCache.get(cacheKey);
        setPlayerHistory(cachedData);
        setHistoryLoading(false);
        return;
      }
      
      const response = await fetch(HISTORY_SHEET_URL);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const json = await response.json();
      if (!json.values || !Array.isArray(json.values)) {
        throw new Error('Invalid rating history data format');
      }
      
      // Parse rating history data - expecting format: [PlayerName, Period, Rating, LastPlayed, Gender, Province]
      const rows = json.values.slice(1); // skip header
      const playerData = rows
        .filter(row => row && row.length >= 3 && row[0] && row[0].toLowerCase() === selectedPlayerName.toLowerCase())
        .map(row => ({
          period: row[1] || '',
          rating: parseInt(row[2], 10) || 0,
          lastPlayed: row[3] || ''
        }))
        .filter(entry => entry.rating > 0)
        .sort((a, b) => {
          // Convert period to date for proper chronological sorting
          // Handle formats like "2024-01", "412", or other period formats
          const parseDate = (period) => {
            if (!period) return new Date(0);
            
            // If it looks like YYYY-MM format
            if (/^\d{4}-\d{2}$/.test(period)) {
              return new Date(period + '-01');
            }
            
            // If it's a numeric period ID, treat as is for now
            if (/^\d+$/.test(period)) {
              return new Date(parseInt(period) * 86400000); // Convert to milliseconds for sorting
            }
            
            // Try to parse as date directly
            const date = new Date(period);
            return isNaN(date.getTime()) ? new Date(0) : date;
          };
          
          const dateA = parseDate(a.period);
          const dateB = parseDate(b.period);
          
          return dateA.getTime() - dateB.getTime();
        });
      
      // Update cache
      setHistoryCache(prev => new Map(prev.set(cacheKey, playerData)));
      setLastHistoryFetch(now);
      
      setPlayerHistory(playerData);
      
    } catch (error) {
      console.error('Error fetching player history:', error);
      setError(`Failed to load rating history: ${error.message}`);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Fetch comparison player history
  const fetchComparePlayerHistory = async (selectedPlayerName) => {
    if (!selectedPlayerName || !selectedPlayerName.trim()) {
      setComparePlayerHistory([]);
      setShowComparison(false);
      return;
    }
    
    setCompareHistoryLoading(true);
    setShowComparison(true);
    
    try {
      // Check cache first (10-minute expiration for better mobile performance)
      const cacheKey = `compare_${selectedPlayerName.toLowerCase()}`;
      const now = Date.now();
      if (historyCache.has(cacheKey) && (now - lastHistoryFetch) < 10 * 60 * 1000) {
        const cachedData = historyCache.get(cacheKey);
        setComparePlayerHistory(cachedData);
        setCompareHistoryLoading(false);
        return;
      }
      
      const response = await fetch(HISTORY_SHEET_URL);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const json = await response.json();
      if (!json.values || !Array.isArray(json.values)) {
        throw new Error('Invalid rating history data format');
      }
      
      // Parse rating history data - expecting format: [PlayerName, Period, Rating, LastPlayed, Gender, Province]
      const rows = json.values.slice(1); // skip header
      const playerData = rows
        .filter(row => row && row.length >= 3 && row[0] && row[0].toLowerCase() === selectedPlayerName.toLowerCase())
        .map(row => ({
          period: row[1] || '',
          rating: parseInt(row[2], 10) || 0,
          lastPlayed: row[3] || ''
        }))
        .filter(entry => entry.rating > 0)
        .sort((a, b) => {
          // Convert period to date for proper chronological sorting
          const parseDate = (period) => {
            if (!period) return new Date(0);
            
            // If it looks like YYYY-MM format
            if (/^\d{4}-\d{2}$/.test(period)) {
              return new Date(period + '-01');
            }
            
            // If it's a numeric period ID, treat as is for now
            if (/^\d+$/.test(period)) {
              return new Date(parseInt(period) * 86400000); // Convert to milliseconds for sorting
            }
            
            // Try to parse as date directly
            const date = new Date(period);
            return isNaN(date.getTime()) ? new Date(0) : date;
          };
          
          const dateA = parseDate(a.period);
          const dateB = parseDate(b.period);
          
          return dateA.getTime() - dateB.getTime();
        });
      
      // Update cache
      setHistoryCache(prev => new Map(prev.set(cacheKey, playerData)));
      setLastHistoryFetch(now);
      
      setComparePlayerHistory(playerData);
      
    } catch (error) {
      console.error('Error fetching comparison player history:', error);
      setError(`Failed to load comparison player history: ${error.message}`);
    } finally {
      setCompareHistoryLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ 
        padding: 32, 
        fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif", 
        textAlign: "center",
        background: "linear-gradient(135deg, #E3F2FD 0%, #90CAF9 50%, #BBDEFB 100%)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center"
      }}>
        <div style={{
          background: "white",
          padding: "40px",
          borderRadius: "25px",
          boxShadow: "0 10px 30px rgba(144, 202, 249, 0.4)",
          border: "3px solid #2196F3"
        }}>
          <h2 style={{ 
            color: "#1976D2", 
            fontSize: "2.5em",
            textShadow: "2px 2px 4px rgba(25, 118, 210, 0.3)",
            marginBottom: "20px"
          }}>
            🏓✨ Loading TTCAN Data ✨🏓
          </h2>
          <div style={{
            width: "60px",
            height: "60px",
            border: "6px solid #90CAF9",
            borderTop: "6px solid #1976D2",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
            margin: "20px auto"
          }} />
          <p style={{ color: "#2196F3", fontSize: "1.2em" }}>
            Please wait while we fetch the latest data! {'(´∀`)'}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ 
        padding: 32, 
        fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
        background: "linear-gradient(135deg, #E3F2FD 0%, #90CAF9 50%, #BBDEFB 100%)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center"
      }}>
        <div style={{
          background: "white",
          padding: "40px",
          borderRadius: "25px",
          boxShadow: "0 10px 30px rgba(144, 202, 249, 0.4)",
          border: "3px solid #FF6B6B",
          textAlign: "center"
        }}>
          <h2 style={{ 
            color: "#FF6B6B", 
            fontSize: "2.2em",
            marginBottom: "20px"
          }}>
            {'(>_<)'} Oops! Something went wrong
          </h2>
          <p style={{ color: "#FF8E8E", fontSize: "1.1em", marginBottom: "30px" }}>
            {error}
          </p>
          <button 
            onClick={() => window.location.reload()} 
            style={{ 
              background: "linear-gradient(45deg, #2196F3, #1976D2)",
              color: "white",
              border: "none",
              padding: "15px 30px",
              fontSize: "1.1em",
              borderRadius: "25px",
              cursor: "pointer",
              boxShadow: "0 5px 15px rgba(33, 150, 243, 0.3)",
              transition: "all 0.3s ease",
              fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif"
            }}
            onMouseOver={(e) => {
              e.target.style.transform = "scale(1.05)";
              e.target.style.boxShadow = "0 7px 20px rgba(33, 150, 243, 0.5)";
            }}
            onMouseOut={(e) => {
              e.target.style.transform = "scale(1)";
              e.target.style.boxShadow = "0 5px 15px rgba(33, 150, 243, 0.3)";
            }}
          >
            🔄 Try Again! ✨
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ 
      minHeight: "100vh",
      background: "linear-gradient(135deg, #E3F2FD 0%, #90CAF9 30%, #BBDEFB 60%, #E3F2FD 100%)",
      fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
      padding: isMobile(windowSize.width) ? "8px" : "20px"
    }}>
      {/* Floating decoration elements - hidden on mobile */}
      {!isMobile(windowSize.width) && (
        <>
          <div className="floating-decoration" style={{
            position: "fixed",
            top: "10%",
            left: "5%",
            fontSize: "3em",
            opacity: 0.3,
            animation: "float 3s ease-in-out infinite",
            zIndex: 1
          }}>🏓</div>
          <div className="floating-decoration" style={{
            position: "fixed",
            top: "20%",
            right: "10%",
            fontSize: "2em",
            opacity: 0.3,
            animation: "float 4s ease-in-out infinite reverse",
            zIndex: 1
          }}>✨</div>
          <div className="floating-decoration" style={{
            position: "fixed",
            bottom: "15%",
            left: "8%",
            fontSize: "2.5em",
            opacity: 0.3,
            animation: "float 3.5s ease-in-out infinite",
            zIndex: 1
          }}>🌸</div>
          <div className="floating-decoration" style={{
            position: "fixed",
            bottom: "10%",
            right: "5%",
            fontSize: "2em",
            opacity: 0.3,
            animation: "float 4.5s ease-in-out infinite reverse",
            zIndex: 1
          }}>💫</div>
        </>
      )}

      <div className="main-container" style={{ 
        maxWidth: "1200px",
        margin: "0 auto",
        position: "relative",
        zIndex: 2,
        padding: isMobile(windowSize.width) ? "12px" : "20px"
      }}>
        <div className="content-card" style={{
          background: "rgba(255, 255, 255, 0.95)",
          borderRadius: isMobile(windowSize.width) ? "16px" : "30px",
          padding: isMobile(windowSize.width) ? "20px" : "40px",
          boxShadow: isMobile(windowSize.width) ? "0 8px 32px rgba(144, 202, 249, 0.3)" : "0 20px 60px rgba(144, 202, 249, 0.3)",
          border: isMobile(windowSize.width) ? "2px solid #2196F3" : "4px solid #2196F3",
          backdropFilter: "blur(10px)"
        }}>
          <h1 className="title-text" style={{ 
            textAlign: "center",
            color: "#1976D2",
            fontSize: isMobile(windowSize.width) ? "1.8em" : "3em",
            textShadow: "3px 3px 6px rgba(25, 118, 210, 0.3)",
            marginBottom: isMobile(windowSize.width) ? "8px" : "10px",
            letterSpacing: isMobile(windowSize.width) ? "1px" : "2px",
            lineHeight: "1.2"
          }}>
            {isMobile(windowSize.width) ? "TTCan Rating Search" : "🏓✨ TTCan Rating Search ✨🏓"}
          </h1>
          
          <p className="subtitle-text" style={{
            textAlign: "center",
            color: "#2196F3",
            fontSize: isMobile(windowSize.width) ? "1em" : "1.3em",
            marginBottom: isMobile(windowSize.width) ? "24px" : "40px",
            fontStyle: "italic",
            lineHeight: "1.4"
          }}>
            Discover the amazing world of Canadian table tennis ratings
          </p>

          {/* First Row: Player Name Input and Active Period */}
          <div className="input-section" style={{
            background: "linear-gradient(45deg, #f5f5f5, #e8e8e8)",
            borderRadius: isMobile(windowSize.width) ? "12px" : "20px",
            padding: isMobile(windowSize.width) ? "16px" : "25px",
            marginBottom: isMobile(windowSize.width) ? "16px" : "20px",
            border: isMobile(windowSize.width) ? "2px solid #2196F3" : "3px solid #2196F3",
            boxShadow: "0 10px 25px rgba(128, 128, 128, 0.2)",
            position: "relative"
          }}>
            <div style={{ 
              display: "grid", 
              gridTemplateColumns: isMobile(windowSize.width) ? "1fr" : "2fr 1fr",
              gap: isMobile(windowSize.width) ? "20px" : "30px",
              alignItems: "start"
            }}>
              {/* Player Name Input */}
              <div>
                <label style={{
                  display: "block",
                  fontSize: isMobile(windowSize.width) ? "1.1em" : "1.3em",
                  color: "#444444",
                  fontWeight: "bold",
                  marginBottom: isMobile(windowSize.width) ? "12px" : "15px",
                  textAlign: isMobile(windowSize.width) ? "left" : "center"
                }}>
                  Player Name
                </label>
                
                <div style={{ position: "relative", maxWidth: isMobile(windowSize.width) ? "100%" : "400px", margin: isMobile(windowSize.width) ? "0" : "0 auto" }}>
                  <input
                    type="text"
                    value={playerName}
                    onChange={handleNameChange}
                    onKeyDown={handleKeyDown}
                    placeholder="Enter your name..."
                    className="name-input"
                    style={{
                      width: "100%",
                      padding: isMobile(windowSize.width) ? "12px 40px 12px 16px" : "15px 45px 15px 15px", // Extra padding on right for clear button
                      fontSize: isMobile(windowSize.width) ? "16px" : "1.1em", // 16px prevents zoom on iOS
                      borderRadius: isMobile(windowSize.width) ? "8px" : "15px",
                      border: isMobile(windowSize.width) ? "2px solid #2196F3" : "3px solid #2196F3",
                      fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
                      color: "#444444",
                      background: "white",
                      boxShadow: "0 5px 15px rgba(128, 128, 128, 0.2)",
                      textAlign: isMobile(windowSize.width) ? "left" : "center"
                    }}
                    onFocus={() => {
                      if (filteredNames.length > 0) {
                        setShowSuggestions(true);
                      }
                    }}
                    onBlur={() => {
                      // Delay hiding suggestions to allow clicking
                      setTimeout(() => {
                        setShowSuggestions(false);
                        setSelectedSuggestionIndex(-1);
                      }, 200);
                    }}
                  />
                  
                  {/* Clear button */}
                  {playerName && (
                    <button
                      onClick={() => {
                        setPlayerName('');
                        setShowSuggestions(false);
                        setSelectedSuggestionIndex(-1);
                        // Clear all filter values
                        setSelectedProvince('all');
                        setSelectedGender('all');
                        setSelectedAge('all');
                        // Hide the rating history section
                        setShowHistory(false);
                        setPlayerHistory([]);
                        // Clear comparison data
                        setComparePlayerName('');
                        setComparePlayerHistory([]);
                        setShowComparison(false);
                        setStartCompareYear('');
                        setStartCompareMonth('');
                      }}
                      style={{
                        position: "absolute",
                        right: isMobile(windowSize.width) ? "6px" : "12px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: isMobile(windowSize.width) ? "#f5f5f5" : "none",
                        border: "none",
                        cursor: "pointer",
                        padding: isMobile(windowSize.width) ? "8px" : "4px",
                        borderRadius: "50%",
                        width: isMobile(windowSize.width) ? "36px" : "32px", // Larger touch target on mobile
                        height: isMobile(windowSize.width) ? "36px" : "32px", // Larger touch target on mobile
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#666",
                        fontSize: isMobile(windowSize.width) ? "18px" : "18px",
                        transition: "all 0.2s ease",
                        minHeight: isMobile(windowSize.width) ? "44px" : "auto", // iOS recommended touch target
                        minWidth: isMobile(windowSize.width) ? "44px" : "auto"
                      }}
                      onMouseOver={(e) => {
                        if (!isMobile(windowSize.width)) {
                          e.target.style.backgroundColor = "#f0f0f0";
                          e.target.style.color = "#333";
                        }
                      }}
                      onMouseOut={(e) => {
                        if (!isMobile(windowSize.width)) {
                          e.target.style.backgroundColor = "transparent";
                          e.target.style.color = "#888";
                        }
                      }}
                      onTouchStart={(e) => {
                        e.target.style.backgroundColor = "#e0e0e0";
                        e.target.style.color = "#333";
                      }}
                      onTouchEnd={(e) => {
                        setTimeout(() => {
                          e.target.style.backgroundColor = "#f5f5f5";
                          e.target.style.color = "#666";
                        }, 150);
                      }}
                      title="Clear search"
                    >
                      ×
                    </button>
                  )}
                  
                  {/* Autocomplete Suggestions */}
                  {showSuggestions && filteredNames.length > 0 && (
                    <div className="autocomplete-suggestions" style={{
                      position: "absolute",
                      top: "100%",
                      left: "0",
                      right: "0",
                      background: "white",
                      border: isMobile(windowSize.width) ? "2px solid #2196F3" : "3px solid #2196F3",
                      borderTop: "none",
                      borderRadius: isMobile(windowSize.width) ? "0 0 8px 8px" : "0 0 15px 15px",
                      maxHeight: isMobile(windowSize.width) ? "160px" : "200px",
                      overflowY: "auto",
                      zIndex: 1000,
                      boxShadow: "0 5px 15px rgba(128, 128, 128, 0.3)"
                    }}>
                      {filteredNames.map((name, index) => (
                        <div
                          key={index}
                          style={{
                            padding: isMobile(windowSize.width) ? "14px 16px" : "10px 15px", // Larger touch targets
                            cursor: "pointer",
                            borderBottom: index < filteredNames.length - 1 ? "1px solid #e8e8e8" : "none",
                            color: "#444444",
                            fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
                            backgroundColor: selectedSuggestionIndex === index ? "#e3f2fd" : "white",
                            fontSize: isMobile(windowSize.width) ? "16px" : "1em", // Prevent zoom on iOS
                            minHeight: isMobile(windowSize.width) ? "44px" : "auto", // iOS recommended touch target
                            display: "flex",
                            alignItems: "center",
                            transition: "background-color 0.2s ease"
                          }}
                          onMouseDown={() => handleNameSelect(name)}
                          onMouseEnter={() => setSelectedSuggestionIndex(index)}
                          onMouseLeave={() => setSelectedSuggestionIndex(-1)}
                        >
                          {name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Active Period Filter */}
              <div>
                <label style={{
                  display: "block",
                  fontSize: isMobile(windowSize.width) ? "1.1em" : "1.3em",
                  color: "#444444",
                  fontWeight: "bold",
                  marginBottom: isMobile(windowSize.width) ? "12px" : "15px",
                  textAlign: isMobile(windowSize.width) ? "left" : "center"
                }}>
                  {isMobile(windowSize.width) ? "Active in Last" : "🗓️ Active in Last"}
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", justifyContent: isMobile(windowSize.width) ? "flex-start" : "center" }}>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={months}
                    onChange={handleMonthsChange}
                    placeholder="All"
                    style={{
                      width: isMobile(windowSize.width) ? "100px" : "80px",
                      padding: isMobile(windowSize.width) ? "12px 16px" : "15px 12px",
                      fontSize: isMobile(windowSize.width) ? "16px" : "1.1em", // Prevent zoom on iOS
                      borderRadius: isMobile(windowSize.width) ? "8px" : "15px",
                      border: isMobile(windowSize.width) ? "2px solid #2196F3" : "3px solid #2196F3",
                      textAlign: "center",
                      fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
                      color: "#444444",
                      background: "white",
                      boxShadow: "0 5px 15px rgba(128, 128, 128, 0.2)"
                    }}
                  />
                  <span style={{ color: "#444444", fontSize: isMobile(windowSize.width) ? "1em" : "1.1em", fontWeight: "bold" }}>months</span>
                </div>
                <div style={{ 
                  textAlign: isMobile(windowSize.width) ? "left" : "center", 
                  marginTop: "8px", 
                  fontSize: "0.9em", 
                  color: "#666666",
                  fontStyle: "italic" 
                }}>
                  (empty = all players)
                </div>
              </div>
            </div>
          </div>

          {/* Second Row: Filter Controls */}
          <div className="filters-section" style={{
            background: "linear-gradient(45deg, #f5f5f5, #e8e8e8)",
            borderRadius: isMobile(windowSize.width) ? "12px" : "20px",
            padding: isMobile(windowSize.width) ? "16px" : "25px",
            marginBottom: isMobile(windowSize.width) ? "20px" : "30px",
            border: isMobile(windowSize.width) ? "2px solid #2196F3" : "3px solid #2196F3",
            boxShadow: "0 10px 25px rgba(128, 128, 128, 0.2)"
          }}>
            <div style={{ 
              display: "grid", 
              gridTemplateColumns: isMobile(windowSize.width) ? "1fr" : "repeat(auto-fit, minmax(200px, 1fr))",
              gap: isMobile(windowSize.width) ? "16px" : "20px",
              alignItems: "center"
            }}>
              {/* Province Filter */}
              <div className="filter-group">
                <label style={{
                  display: "block",
                  fontSize: isMobile(windowSize.width) ? "1em" : "1.1em",
                  color: "#444444",
                  fontWeight: "bold",
                  marginBottom: "8px"
                }}>
                  {isMobile(windowSize.width) ? "Province" : "🏛️ Province"}
                </label>
                <select
                  value={selectedProvince}
                  onChange={(e) => setSelectedProvince(e.target.value)}
                  style={{
                    width: "100%",
                    padding: isMobile(windowSize.width) ? "14px 16px" : "12px",
                    fontSize: isMobile(windowSize.width) ? "16px" : "1em", // Prevent zoom on iOS
                    borderRadius: isMobile(windowSize.width) ? "8px" : "10px",
                    border: "2px solid #2196F3",
                    fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
                    color: "#444444",
                    background: "white",
                    cursor: "pointer",
                    minHeight: isMobile(windowSize.width) ? "48px" : "auto" // Better touch target
                  }}
                >
                  <option value="all">All Provinces</option>
                  {Object.entries(provinceCounts)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([province, count]) => (
                      <option key={province} value={province}>
                        {province}
                      </option>
                    ))}
                </select>
              </div>

              {/* Gender Filter */}
              <div className="filter-group">
                <label style={{
                  display: "block",
                  fontSize: isMobile(windowSize.width) ? "1em" : "1.1em",
                  color: "#444444",
                  fontWeight: "bold",
                  marginBottom: "8px"
                }}>
                  {isMobile(windowSize.width) ? "Gender" : "👫 Gender"}
                </label>
                <select
                  value={selectedGender}
                  onChange={(e) => setSelectedGender(e.target.value)}
                  style={{
                    width: "100%",
                    padding: isMobile(windowSize.width) ? "14px 16px" : "12px",
                    fontSize: isMobile(windowSize.width) ? "16px" : "1em",
                    borderRadius: isMobile(windowSize.width) ? "8px" : "10px",
                    border: "2px solid #2196F3",
                    fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
                    color: "#444444",
                    background: "white",
                    cursor: "pointer",
                    minHeight: isMobile(windowSize.width) ? "48px" : "auto"
                  }}
                >
                  <option value="all">All</option>
                  <option value="F">Girls</option>
                  <option value="M">Boys</option>
                </select>
              </div>

              {/* Age Filter */}
              <div className="filter-group">
                <label style={{
                  display: "block",
                  fontSize: isMobile(windowSize.width) ? "1em" : "1.1em",
                  color: "#444444",
                  fontWeight: "bold",
                  marginBottom: "8px"
                }}>
                  {isMobile(windowSize.width) ? "Age Category" : "🎂 Age"}
                </label>
                <select
                  value={selectedAge}
                  onChange={(e) => setSelectedAge(e.target.value)}
                  style={{
                    width: "100%",
                    padding: isMobile(windowSize.width) ? "14px 16px" : "12px",
                    fontSize: isMobile(windowSize.width) ? "16px" : "1em",
                    borderRadius: isMobile(windowSize.width) ? "8px" : "10px",
                    border: "2px solid #2196F3",
                    fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
                    color: "#444444",
                    background: "white",
                    cursor: "pointer",
                    minHeight: isMobile(windowSize.width) ? "48px" : "auto"
                  }}
                >
                  <option value="all">All Ages</option>
                  <option value="u9">U9</option>
                  <option value="u10">U10</option>
                  <option value="u11">U11</option>
                  <option value="u12">U12</option>
                  <option value="u13">U13</option>
                  <option value="u14">U14</option>
                  <option value="u15">U15</option>
                  <option value="u17">U17</option>
                  <option value="u19">U19</option>
                </select>
              </div>
            </div>
          </div>

          {/* Active Players Count */}
          <div style={{
            background: "linear-gradient(45deg, #f0f7ff, #e3f2fd)",
            borderRadius: isMobile(windowSize.width) ? "12px" : "16px",
            padding: isMobile(windowSize.width) ? "16px" : "20px",
            marginBottom: isMobile(windowSize.width) ? "20px" : "30px",
            textAlign: "center",
            border: "1px solid #2196F3",
            boxShadow: "0 4px 12px rgba(33, 150, 243, 0.1)"
          }}>
            <div style={{ 
              fontSize: isMobile(windowSize.width) ? "1.1em" : "1.3em", 
              color: "#1976D2",
              fontWeight: "600"
            }}>
              Total active {selectedGender === 'all' ? 'players' : (selectedGender === 'F' ? 'girls' : 'boys')}{selectedAge !== 'all' ? ` (${selectedAge.toUpperCase()})` : ''}{selectedProvince !== 'all' ? ` in ${selectedProvince}` : ''} in the last {months === '' || months === '0' ? 'all time' : `${months} month${months !== '1' ? 's' : ''}`}: {activePlayerCount}
            </div>
          </div>

          {/* Top 100 Players List */}
          <div className="top-players-section" style={{
            background: "linear-gradient(45deg, #EDE7F6, #D1C4E9)",
            borderRadius: isMobile(windowSize.width) ? "12px" : "20px",
            padding: isMobile(windowSize.width) ? "16px" : "25px",
            marginTop: isMobile(windowSize.width) ? "20px" : "30px",
            border: isMobile(windowSize.width) ? "2px solid #512DA8" : "3px solid #512DA8",
            boxShadow: "0 10px 25px rgba(81, 45, 168, 0.2)"
          }}>
            <h2 style={{
              textAlign: "center",
              color: "#4527A0",
              fontSize: isMobile(windowSize.width) ? "1.5em" : "2em",
              marginBottom: isMobile(windowSize.width) ? "16px" : "20px",
              textShadow: "2px 2px 4px rgba(69, 39, 160, 0.3)",
              lineHeight: "1.3"
            }}>
              {isMobile(windowSize.width) ? "Top 100 Players" : "🏆 Top 100 Players"} {selectedGender !== 'all' ? `(${selectedGender === 'F' ? 'Girls' : 'Boys'})` : ''}
              {selectedProvince !== 'all' ? ` in ${selectedProvince}` : ''}
              {selectedAge !== 'all' ? `, ${selectedAge.toUpperCase()}` : ''}
            </h2>
            
{isMobile(windowSize.width) ? (
              /* Mobile Card Layout */
              <div style={{ 
                maxHeight: "500px", 
                overflowY: "auto",
                background: "white",
                borderRadius: "8px",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)"
              }}>
                {topPlayers.map((player, index) => (
                  <div
                    key={`${player.name}-${player.rating}-${index}`}
                    data-player-name={player.name}
                    style={{
                      padding: "16px",
                      borderBottom: index < topPlayers.length - 1 ? "1px solid #e8e8e8" : "none",
                      backgroundColor: player.name === playerName ? "#E3F2FD" : "white",
                      cursor: "pointer",
                      transition: "background-color 0.2s ease",
                      border: player.name === playerName ? "2px solid #2196F3" : "none",
                      borderRadius: player.name === playerName ? "8px" : "0",
                      margin: player.name === playerName ? "2px" : "0"
                    }}
                    onClick={() => handleNameSelect(player.name)}
                    onTouchStart={(e) => {
                      if (player.name !== playerName) {
                        e.currentTarget.style.backgroundColor = "#EDE7F6";
                      }
                    }}
                    onTouchEnd={(e) => {
                      setTimeout(() => {
                        if (player.name === playerName) {
                          e.currentTarget.style.backgroundColor = "#E3F2FD";
                        } else {
                          e.currentTarget.style.backgroundColor = "white";
                        }
                      }, 150);
                    }}
                  >
                    {/* Rank and Name Row */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                      <div style={{
                        fontWeight: "bold",
                        color: player.rank <= 3 ? (player.rank === 1 ? "#FFD700" : player.rank === 2 ? "#C0C0C0" : "#CD7F32") : "#333",
                        fontSize: "1.2em"
                      }}>
                        {player.rank <= 3 ? (player.rank === 1 ? "🥇" : player.rank === 2 ? "🥈" : "🥉") : `#${player.rank}`}
                      </div>
                      <div style={{ 
                        fontWeight: "600", 
                        color: "#4527A0",
                        fontSize: "1.1em",
                        flex: 1,
                        textAlign: "right"
                      }}>
                        {player.name}
                      </div>
                    </div>
                    
                    {/* Rating Row */}
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                      <span style={{ color: "#666", fontSize: "0.9em" }}>Rating:</span>
                      <span style={{ fontWeight: "bold", color: "#1976D2", fontSize: "1.1em" }}>
                        {player.rating}
                      </span>
                    </div>
                    
                    {/* Details Row */}
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9em", color: "#666" }}>
                      <span>{player.province} • {player.gender || 'N/A'} • Age {player.age || 'N/A'}</span>
                      <span>{player.lastPlayed}</span>
                    </div>
                  </div>
                ))}
                
                {topPlayers.length === 0 && (
                  <div style={{
                    padding: "40px 16px",
                    textAlign: "center",
                    color: "#666",
                    fontSize: "1em",
                    fontStyle: "italic"
                  }}>
                    No players found for the selected criteria
                  </div>
                )}
              </div>
            ) : (
              /* Desktop Table Layout */
              <div className="top-players-table" style={{
                background: "white",
                borderRadius: "15px",
                overflow: "hidden",
                boxShadow: "0 5px 15px rgba(0, 0, 0, 0.1)"
              }}>
                {/* Table Header */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: isMobile(windowSize.width) 
                    ? "50px 2fr 80px 100px" // Mobile: Rank, Name, Rating, Last Played only
                    : "60px 2fr 1fr 80px 100px 80px 120px", // Desktop: all columns
                  gap: isMobile(windowSize.width) ? "8px" : "10px",
                  padding: isMobile(windowSize.width) ? "12px 8px" : "15px",
                  background: "linear-gradient(45deg, #512DA8, #4527A0)",
                  color: "white",
                  fontWeight: "bold",
                  fontSize: isMobile(windowSize.width) ? "0.9em" : "1em",
                  textAlign: "center",
                  alignItems: "center"
                }}>
                  <div>Rank</div>
                  <div>Name</div>
                  {!isMobile(windowSize.width) && <div>Province</div>}
                  {!isMobile(windowSize.width) && <div>Gender</div>}
                  <div>Rating</div>
                  {!isMobile(windowSize.width) && <div>Age</div>}
                  <div>Last Played</div>
                </div>
                
                {/* Table Rows */}
                <div className="table-container" style={{ maxHeight: isMobile(windowSize.width) ? "400px" : "600px", overflowY: "auto" }}>
                  {topPlayers.map((player, index) => (
                    <div
                      key={`${player.name}-${player.rating}-${index}`}
                      data-player-name={player.name}
                      style={{
                        display: "grid",
                        gridTemplateColumns: isMobile(windowSize.width) 
                          ? "50px 2fr 80px 100px" // Mobile: Rank, Name, Rating, Last Played only
                          : "60px 2fr 1fr 80px 100px 80px 120px", // Desktop: all columns
                        gap: isMobile(windowSize.width) ? "8px" : "10px",
                        padding: isMobile(windowSize.width) ? "12px 8px" : "12px 15px",
                        borderBottom: index < topPlayers.length - 1 ? "1px solid #e8e8e8" : "none",
                        backgroundColor: player.name === playerName ? "#E3F2FD" : (index % 2 === 0 ? "#f9f9f9" : "white"),
                        fontSize: isMobile(windowSize.width) ? "0.85em" : "0.95em",
                        textAlign: "center",
                        alignItems: "center",
                        cursor: "pointer",
                        transition: "background-color 0.2s ease",
                        border: player.name === playerName ? "2px solid #2196F3" : "none",
                        borderRadius: player.name === playerName ? "8px" : "0",
                        margin: player.name === playerName ? "2px" : "0",
                        minHeight: isMobile(windowSize.width) ? "48px" : "auto" // Better touch target
                      }}
                      onMouseOver={(e) => {
                        if (player.name !== playerName) {
                          e.currentTarget.style.backgroundColor = "#EDE7F6";
                        }
                      }}
                      onMouseOut={(e) => {
                        if (player.name === playerName) {
                          e.currentTarget.style.backgroundColor = "#E3F2FD";
                        } else {
                          e.currentTarget.style.backgroundColor = index % 2 === 0 ? "#f9f9f9" : "white";
                        }
                      }}
                      onClick={() => handleNameSelect(player.name)}
                    >
                      <div style={{
                        fontWeight: "bold",
                        color: player.rank <= 3 ? (player.rank === 1 ? "#FFD700" : player.rank === 2 ? "#C0C0C0" : "#CD7F32") : "#333",
                        fontSize: player.rank <= 3 ? "1.1em" : "1em"
                      }}>
                        {player.rank <= 3 ? (player.rank === 1 ? "🥇" : player.rank === 2 ? "🥈" : "🥉") : `#${player.rank}`}
                      </div>
                      <div style={{ textAlign: "left", fontWeight: "500", color: "#4527A0" }}>
                        {isMobile(windowSize.width) ? (
                          <div>
                            <div>{player.name}</div>
                            <div style={{ fontSize: "0.75em", color: "#666", marginTop: "2px" }}>
                              {player.province} • {player.gender || 'N/A'} • Age {player.age || 'N/A'}
                            </div>
                          </div>
                        ) : (
                          player.name
                        )}
                      </div>
                      {!isMobile(windowSize.width) && (
                        <div style={{ color: "#666" }}>
                          {player.province}
                        </div>
                      )}
                      {!isMobile(windowSize.width) && (
                        <div style={{ color: "#666" }}>
                          {player.gender || 'N/A'}
                        </div>
                      )}
                      <div style={{ fontWeight: "bold", color: "#1976D2" }}>
                        {player.rating}
                      </div>
                      {!isMobile(windowSize.width) && (
                        <div style={{ color: "#666" }}>
                          {player.age || 'N/A'}
                        </div>
                      )}
                      <div style={{ color: "#666", fontSize: isMobile(windowSize.width) ? "0.75em" : "0.9em" }}>
                        {isMobile(windowSize.width) ? player.lastPlayed.replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/, '$1/$2') : player.lastPlayed}
                      </div>
                    </div>
                  ))}
                </div>
                
                {topPlayers.length === 0 && (
                  <div style={{
                    padding: "40px",
                    textAlign: "center",
                    color: "#666",
                    fontSize: "1.1em",
                    fontStyle: "italic"
                  }}>
                    No players found for the selected criteria
                  </div>
                )}
              </div>
            )}
          </div>


          {/* Rating History Chart */}
          {showHistory && (
            <div className="rating-history-section" style={{
              background: "linear-gradient(45deg, #f0f7ff, #e3f2fd)",
              borderRadius: isMobile(windowSize.width) ? "12px" : "20px",
              padding: isMobile(windowSize.width) ? "16px" : "25px",
              marginTop: isMobile(windowSize.width) ? "20px" : "30px",
              border: isMobile(windowSize.width) ? "2px solid #2196F3" : "3px solid #2196F3",
              boxShadow: "0 10px 25px rgba(33, 150, 243, 0.2)"
            }}>
              <h2 style={{
                textAlign: "center",
                color: "#1976D2",
                fontSize: isMobile(windowSize.width) ? "1.4em" : "1.8em",
                marginBottom: isMobile(windowSize.width) ? "16px" : "20px",
                textShadow: "2px 2px 4px rgba(25, 118, 210, 0.3)"
              }}>
                {isMobile(windowSize.width) ? "Rating History" : "📈 Rating History"} - {playerName}
              </h2>
              
              <RatingHistoryChart 
                key={`${playerName}-${comparePlayerName}-${startCompareYear}-${startCompareMonth}`}
                playerHistory={playerHistory}
                playerName={playerName}
                windowSize={windowSize}
                historyLoading={historyLoading}
                comparePlayerHistory={comparePlayerHistory}
                comparePlayerName={comparePlayerName}
                compareHistoryLoading={compareHistoryLoading}
                startCompareYear={startCompareYear}
                startCompareMonth={startCompareMonth}
              />
              
              {/* Player Comparison Controls */}
              <div style={{
                marginTop: "20px",
                padding: isMobile(windowSize.width) ? "16px" : "20px",
                background: "linear-gradient(45deg, #f0f7ff, #e3f2fd)",
                borderRadius: isMobile(windowSize.width) ? "8px" : "12px",
                border: "2px solid #2196F3"
              }}>
                <h3 style={{
                  color: "#1976D2",
                  fontSize: isMobile(windowSize.width) ? "1.1em" : "1.3em",
                  marginBottom: "16px",
                  textAlign: "center"
                }}>
                  Compare Players
                </h3>
                
                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: isMobile(windowSize.width) ? "20px" : "16px",
                  alignItems: "stretch"
                }}>
                  {/* Compare Player Input */}
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: isMobile(windowSize.width) ? "12px" : "8px",
                    position: "relative"
                  }}>
                    <label style={{
                      color: "#1976D2",
                      fontWeight: "bold",
                      fontSize: isMobile(windowSize.width) ? "1em" : "1em"
                    }}>
                      Compare Player:
                    </label>
                    <input
                      type="text"
                      value={comparePlayerName}
                      onChange={handleCompareNameChange}
                      onKeyDown={handleCompareKeyDown}
                      placeholder="Enter player name to compare..."
                      style={{
                        padding: isMobile(windowSize.width) ? "12px" : "10px",
                        fontSize: isMobile(windowSize.width) ? "16px" : "1em",
                        borderRadius: "8px",
                        border: "2px solid #2196F3",
                        fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
                        minHeight: isMobile(windowSize.width) ? "44px" : "auto"
                      }}
                      onFocus={() => {
                        if (compareFilteredNames.length > 0) {
                          setShowCompareSuggestions(true);
                        }
                      }}
                      onBlur={() => {
                        // Delay hiding suggestions to allow clicking
                        setTimeout(() => {
                          setShowCompareSuggestions(false);
                          setSelectedCompareSuggestionIndex(-1);
                        }, 200);
                      }}
                    />
                    
                    {/* Compare Player Autocomplete Suggestions */}
                    {showCompareSuggestions && compareFilteredNames.length > 0 && (
                      <div className="autocomplete-suggestions" style={{
                        position: "absolute",
                        top: "100%",
                        left: "0",
                        right: "0",
                        background: "white",
                        border: isMobile(windowSize.width) ? "2px solid #2196F3" : "3px solid #2196F3",
                        borderTop: "none",
                        borderRadius: isMobile(windowSize.width) ? "0 0 8px 8px" : "0 0 15px 15px",
                        maxHeight: isMobile(windowSize.width) ? "160px" : "200px",
                        overflowY: "auto",
                        zIndex: 1000,
                        boxShadow: "0 5px 15px rgba(128, 128, 128, 0.3)"
                      }}>
                        {compareFilteredNames.map((name, index) => (
                          <div
                            key={index}
                            style={{
                              padding: isMobile(windowSize.width) ? "14px 16px" : "10px 15px",
                              cursor: "pointer",
                              borderBottom: index < compareFilteredNames.length - 1 ? "1px solid #e8e8e8" : "none",
                              color: "#444444",
                              fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
                              backgroundColor: selectedCompareSuggestionIndex === index ? "#e3f2fd" : "white",
                              fontSize: isMobile(windowSize.width) ? "16px" : "1em",
                              minHeight: isMobile(windowSize.width) ? "44px" : "auto",
                              display: "flex",
                              alignItems: "center",
                              transition: "background-color 0.2s ease"
                            }}
                            onMouseDown={() => handleCompareNameSelect(name)}
                            onMouseEnter={() => setSelectedCompareSuggestionIndex(index)}
                            onMouseLeave={() => setSelectedCompareSuggestionIndex(-1)}
                          >
                            {name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  {/* Start Date Control */}
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: isMobile(windowSize.width) ? "12px" : "8px"
                  }}>
                    <label style={{
                      color: "#1976D2",
                      fontWeight: "bold",
                      fontSize: isMobile(windowSize.width) ? "1em" : "1em"
                    }}>
                      Start From (YYYY-MM):
                    </label>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: isMobile(windowSize.width) ? "12px" : "8px",
                      justifyContent: isMobile(windowSize.width) ? "flex-start" : "flex-start"
                    }}>
                      <input
                        type="number"
                        value={startCompareYear}
                        onChange={(e) => setStartCompareYear(e.target.value)}
                        placeholder={earliestYear.toString()}
                        min={earliestYear.toString()}
                        max="2030"
                        style={{
                          padding: isMobile(windowSize.width) ? "14px 12px" : "10px",
                          fontSize: isMobile(windowSize.width) ? "16px" : "1em",
                          borderRadius: isMobile(windowSize.width) ? "10px" : "8px",
                          border: "2px solid #2196F3",
                          fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
                          minHeight: isMobile(windowSize.width) ? "48px" : "auto",
                          width: isMobile(windowSize.width) ? "100px" : "80px",
                          textAlign: "center",
                          appearance: "none",
                          WebkitAppearance: "none",
                          MozAppearance: "textfield"
                        }}
                      />
                      <span style={{
                        color: "#1976D2",
                        fontWeight: "bold",
                        fontSize: isMobile(windowSize.width) ? "1.4em" : "1.5em",
                        minWidth: isMobile(windowSize.width) ? "20px" : "auto",
                        textAlign: "center"
                      }}>
                        -
                      </span>
                      <input
                        type="number"
                        value={startCompareMonth}
                        onChange={(e) => setStartCompareMonth(e.target.value)}
                        placeholder="01"
                        min="1"
                        max="12"
                        style={{
                          padding: isMobile(windowSize.width) ? "14px 12px" : "10px",
                          fontSize: isMobile(windowSize.width) ? "16px" : "1em",
                          borderRadius: isMobile(windowSize.width) ? "10px" : "8px",
                          border: "2px solid #2196F3",
                          fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
                          minHeight: isMobile(windowSize.width) ? "48px" : "auto",
                          width: isMobile(windowSize.width) ? "80px" : "60px",
                          textAlign: "center",
                          appearance: "none",
                          WebkitAppearance: "none",
                          MozAppearance: "textfield"
                        }}
                      />
                    </div>
                    <div style={{
                      fontSize: "0.8em",
                      color: "#666",
                      fontStyle: "italic"
                    }}>
                      Leave empty for all data
                    </div>
                  </div>
                  
                  {/* Clear Button */}
                  {comparePlayerName && (
                    <button
                      onClick={() => {
                        setComparePlayerName('');
                        setComparePlayerHistory([]);
                        setShowComparison(false);
                        setStartCompareYear('');
                        setStartCompareMonth('');
                      }}
                      style={{
                        padding: isMobile(windowSize.width) ? "16px 20px" : "10px 16px",
                        backgroundColor: "#FF6B35",
                        color: "white",
                        border: "none",
                        borderRadius: isMobile(windowSize.width) ? "12px" : "8px",
                        fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
                        fontWeight: "bold",
                        cursor: "pointer",
                        fontSize: isMobile(windowSize.width) ? "16px" : "1em",
                        minHeight: isMobile(windowSize.width) ? "48px" : "auto",
                        alignSelf: "stretch",
                        boxShadow: isMobile(windowSize.width) ? "0 2px 8px rgba(255, 107, 53, 0.3)" : "none",
                        transition: "all 0.2s ease"
                      }}
                      onTouchStart={(e) => {
                        e.target.style.transform = "scale(0.98)";
                        e.target.style.backgroundColor = "#e55a2b";
                      }}
                      onTouchEnd={(e) => {
                        setTimeout(() => {
                          e.target.style.transform = "scale(1)";
                          e.target.style.backgroundColor = "#FF6B35";
                        }, 150);
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                
                {comparePlayerName && comparePlayerHistory.length === 0 && !compareHistoryLoading && (
                  <div style={{
                    marginTop: "12px",
                    padding: "8px",
                    backgroundColor: "#fff3cd",
                    color: "#856404",
                    borderRadius: "4px",
                    fontSize: "0.9em",
                    textAlign: "center"
                  }}>
                    No rating history found for "{comparePlayerName}"
                  </div>
                )}
              </div>
              
            </div>
          )}
        </div>
      </div>
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