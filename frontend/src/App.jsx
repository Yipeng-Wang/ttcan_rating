import React, { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, ReferenceLine } from "recharts";

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
    player.lastPlayed &&
    player.gender &&
    (player.gender === 'F' || player.gender === 'M')
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
  const [playerName, setPlayerName] = useState('');
  const [playerInfo, setPlayerInfo] = useState(null);
  const [filteredNames, setFilteredNames] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedGender, setSelectedGender] = useState('all');
  const [genderCounts, setGenderCounts] = useState({ F: 0, M: 0 });

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
              province: cols[1] || '',
              gender: cols[2] || '',
              rating: parseInt(cols[3], 10),
              period: cols[4] || '',
              lastPlayed: cols[5] || '',
            };
            
            return validatePlayerData(player) ? player : null;
          })
          .filter(player => player !== null);
        
        setData(parsed);
        
        // Calculate gender distribution
        const genderCount = parsed.reduce((acc, player) => {
          acc[player.gender] = (acc[player.gender] || 0) + 1;
          return acc;
        }, {});
        setGenderCounts(genderCount);
        
        console.log(`Loaded ${parsed.length} valid players (${genderCount.F || 0} Female, ${genderCount.M || 0} Male)`);
        
      } catch (err) {
        console.error('Error fetching data:', err);
        setError(`Failed to load data: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [SHEET_URL]);

  // Re-filter and update histogram/count when data, months, or gender changes
  useEffect(() => {
    try {
      // If months is empty or 0, show all data
      const monthsValue = months === '' || months === '0' ? 1000 : Number(months);
      let filtered = data.filter(x => isWithinLastNMonths(x.lastPlayed, monthsValue));
      
      // Apply gender filter
      if (selectedGender !== 'all') {
        filtered = filtered.filter(x => x.gender === selectedGender);
      }
      setActivePlayerCount(filtered.length);
      setHist(makeHistogram(filtered, 100));
      
      // Update player info if a player is selected
      if (playerName) {
        const player = filtered.find(p => p.name === playerName);
        if (player) {
          // Recalculate percentile with new filtered data
          const ratings = filtered.map(p => p.rating).sort((a, b) => b - a); // Sort descending
          const playerRating = player.rating;
          const playerRank = ratings.findIndex(r => r <= playerRating) + 1;
          const percentile = ((playerRank / ratings.length) * 100).toFixed(1);
          
          setPlayerInfo({
            name: player.name,
            rating: player.rating,
            gender: player.gender,
            percentile: percentile,
            lastPlayed: player.lastPlayed,
            isActive: true
          });
        } else {
          // Check if player exists in full dataset but not in filtered data
          const playerInFullData = data.find(p => p.name === playerName);
          if (playerInFullData) {
            setPlayerInfo({
              name: playerInFullData.name,
              rating: playerInFullData.rating,
              gender: playerInFullData.gender,
              percentile: null,
              lastPlayed: playerInFullData.lastPlayed,
              isActive: false
            });
          } else {
            setPlayerInfo(null);
          }
        }
      }
    } catch (err) {
      console.error('Error filtering data:', err);
      setError('Error processing data');
    }
  }, [months, data, playerName, selectedGender]);

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

  const handleNameChange = (e) => {
    const value = e.target.value;
    setPlayerName(value);
    
    if (value.length > 0) {
      // Filter names based on input and gender
      let filteredData = data.filter(player => 
        player.name.toLowerCase().includes(value.toLowerCase())
      );
      
      // Apply gender filter
      if (selectedGender !== 'all') {
        filteredData = filteredData.filter(player => player.gender === selectedGender);
      }
      
      const filtered = filteredData
        .map(player => player.name)
        .slice(0, 10); // Limit to 10 suggestions
      
      setFilteredNames(filtered);
      setShowSuggestions(true);
    } else {
      setFilteredNames([]);
      setShowSuggestions(false);
      setPlayerInfo(null);
    }
  };

  const handleNameSelect = (name) => {
    setPlayerName(name);
    setShowSuggestions(false);
    
    // Find player info
    const monthsValue = months === '' || months === '0' ? 1000 : Number(months);
    let filteredData = data.filter(x => isWithinLastNMonths(x.lastPlayed, monthsValue));
    
    // Apply gender filter
    if (selectedGender !== 'all') {
      filteredData = filteredData.filter(x => x.gender === selectedGender);
    }
    
    const player = filteredData.find(p => p.name === name);
    
    if (player) {
      // Calculate percentile
      const ratings = filteredData.map(p => p.rating).sort((a, b) => b - a); // Sort descending
      const playerRating = player.rating;
      const playerRank = ratings.findIndex(r => r <= playerRating) + 1;
      const percentile = ((playerRank / ratings.length) * 100).toFixed(1);
      
      setPlayerInfo({
        name: player.name,
        rating: player.rating,
        gender: player.gender,
        percentile: percentile,
        lastPlayed: player.lastPlayed,
        isActive: true
      });
    } else {
      // Check if player exists in full dataset but not in filtered data
      const playerInFullData = data.find(p => p.name === name);
      if (playerInFullData) {
        setPlayerInfo({
          name: playerInFullData.name,
          rating: playerInFullData.rating,
          gender: playerInFullData.gender,
          percentile: null,
          lastPlayed: playerInFullData.lastPlayed,
          isActive: false
        });
      } else {
        setPlayerInfo(null);
      }
    }
  };

  const calculatePercentileLine = () => {
    if (!playerInfo || !playerInfo.isActive) return null;
    
    const playerRating = playerInfo.rating;
    
    // Find which bin the player falls into
    const binSize = 100;
    const binStart = Math.floor(playerRating / binSize) * binSize;
    const binEnd = binStart + binSize - 1;
    
    return {
      binRange: `${binStart}-${binEnd}`,
      rating: playerRating,
      percentile: playerInfo.percentile
    };
  };

  if (loading) {
    return (
      <div style={{ 
        padding: 32, 
        fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif", 
        textAlign: "center",
        background: "linear-gradient(135deg, #FFE4E1 0%, #FFB6C1 50%, #FFC0CB 100%)",
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
          boxShadow: "0 10px 30px rgba(255, 182, 193, 0.4)",
          border: "3px solid #FF69B4"
        }}>
          <h2 style={{ 
            color: "#FF1493", 
            fontSize: "2.5em",
            textShadow: "2px 2px 4px rgba(255, 20, 147, 0.3)",
            marginBottom: "20px"
          }}>
            🏓✨ Loading TTCAN Data ✨🏓
          </h2>
          <div style={{
            width: "60px",
            height: "60px",
            border: "6px solid #FFB6C1",
            borderTop: "6px solid #FF1493",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
            margin: "20px auto"
          }} />
          <p style={{ color: "#FF69B4", fontSize: "1.2em" }}>
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
        background: "linear-gradient(135deg, #FFE4E1 0%, #FFB6C1 50%, #FFC0CB 100%)",
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
          boxShadow: "0 10px 30px rgba(255, 182, 193, 0.4)",
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
              background: "linear-gradient(45deg, #FF69B4, #FF1493)",
              color: "white",
              border: "none",
              padding: "15px 30px",
              fontSize: "1.1em",
              borderRadius: "25px",
              cursor: "pointer",
              boxShadow: "0 5px 15px rgba(255, 105, 180, 0.3)",
              transition: "all 0.3s ease",
              fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif"
            }}
            onMouseOver={(e) => {
              e.target.style.transform = "scale(1.05)";
              e.target.style.boxShadow = "0 7px 20px rgba(255, 105, 180, 0.5)";
            }}
            onMouseOut={(e) => {
              e.target.style.transform = "scale(1)";
              e.target.style.boxShadow = "0 5px 15px rgba(255, 105, 180, 0.3)";
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
      background: "linear-gradient(135deg, #FFE4E1 0%, #FFB6C1 30%, #FFC0CB 60%, #FFE4E1 100%)",
      fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
      padding: "20px"
    }}>
      {/* Floating decoration elements */}
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

      <div className="main-container" style={{ 
        maxWidth: "1200px",
        margin: "0 auto",
        position: "relative",
        zIndex: 2,
        padding: "20px"
      }}>
        <div className="content-card" style={{
          background: "rgba(255, 255, 255, 0.95)",
          borderRadius: "30px",
          padding: "40px",
          boxShadow: "0 20px 60px rgba(255, 182, 193, 0.3)",
          border: "4px solid #FF69B4",
          backdropFilter: "blur(10px)"
        }}>
          <h1 className="title-text" style={{ 
            textAlign: "center",
            color: "#FF1493",
            fontSize: "3em",
            textShadow: "3px 3px 6px rgba(255, 20, 147, 0.3)",
            marginBottom: "10px",
            letterSpacing: "2px"
          }}>
            🏓✨ TTCAN Rating Analytics ✨🏓
          </h1>
          
          <p className="subtitle-text" style={{
            textAlign: "center",
            color: "#FF69B4",
            fontSize: "1.3em",
            marginBottom: "40px",
            fontStyle: "italic"
          }}>
            Discover the amazing world of table tennis ratings! {'(◕‿◕)'}
          </p>

          <div className="input-section" style={{
            background: "linear-gradient(45deg, #FFE4E1, #FFB6C1)",
            borderRadius: "20px",
            padding: "25px",
            marginBottom: "30px",
            border: "3px solid #FF69B4",
            boxShadow: "0 10px 25px rgba(255, 105, 180, 0.2)"
          }}>
            <div style={{ 
              display: "flex", 
              flexDirection: "column", 
              gap: "20px",
              alignItems: "center"
            }}>
              <label className="input-label" style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.3em",
                color: "#FF1493",
                fontWeight: "bold",
                gap: "15px"
              }}>
                <span>🗓️ Show players active in last</span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={months}
                  onChange={handleMonthsChange}
                  className="number-input"
                  style={{ 
                    width: "80px",
                    padding: "12px",
                    fontSize: "1.2em",
                    borderRadius: "15px",
                    border: "3px solid #FF69B4",
                    textAlign: "center",
                    fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
                    fontWeight: "bold",
                    color: "#FF1493",
                    background: "white",
                    boxShadow: "0 5px 15px rgba(255, 105, 180, 0.2)"
                  }}
                />
                <span>month(s) 📊</span>
              </label>
              
              <label className="gender-label" style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.3em",
                color: "#FF1493",
                fontWeight: "bold",
                gap: "15px"
              }}>
                <span>👫 Gender Filter:</span>
                <select
                  value={selectedGender}
                  onChange={(e) => setSelectedGender(e.target.value)}
                  style={{
                    padding: "12px",
                    fontSize: "1.1em",
                    borderRadius: "15px",
                    border: "3px solid #FF69B4",
                    fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
                    fontWeight: "bold",
                    color: "#FF1493",
                    background: "white",
                    boxShadow: "0 5px 15px rgba(255, 105, 180, 0.2)",
                    cursor: "pointer"
                  }}
                >
                  <option value="all">All ({genderCounts.F + genderCounts.M})</option>
                  <option value="F">Girls ({genderCounts.F})</option>
                  <option value="M">Boys ({genderCounts.M})</option>
                </select>
              </label>
            </div>
          </div>
          
          {/* Player Name Input */}
          <div className="input-section" style={{
            background: "linear-gradient(45deg, #FFE4E1, #FFB6C1)",
            borderRadius: "20px",
            padding: "25px",
            marginBottom: "30px",
            border: "3px solid #FF69B4",
            boxShadow: "0 10px 25px rgba(255, 105, 180, 0.2)",
            position: "relative"
          }}>
            <label style={{
              display: "block",
              fontSize: "1.3em",
              color: "#FF1493",
              fontWeight: "bold",
              marginBottom: "15px",
              textAlign: "center"
            }}>
              🏓 Find Your Rating Percentile! ✨
            </label>
            
            <div style={{ position: "relative", maxWidth: "400px", margin: "0 auto" }}>
              <input
                type="text"
                value={playerName}
                onChange={handleNameChange}
                placeholder="Enter your name..."
                className="name-input"
                style={{
                  width: "100%",
                  padding: "15px",
                  fontSize: "1.1em",
                  borderRadius: "15px",
                  border: "3px solid #FF69B4",
                  fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
                  color: "#FF1493",
                  background: "white",
                  boxShadow: "0 5px 15px rgba(255, 105, 180, 0.2)",
                  textAlign: "center"
                }}
                onFocus={() => {
                  if (filteredNames.length > 0) {
                    setShowSuggestions(true);
                  }
                }}
                onBlur={() => {
                  // Delay hiding suggestions to allow clicking
                  setTimeout(() => setShowSuggestions(false), 200);
                }}
              />
              
              {/* Autocomplete Suggestions */}
              {showSuggestions && filteredNames.length > 0 && (
                <div className="autocomplete-suggestions" style={{
                  position: "absolute",
                  top: "100%",
                  left: "0",
                  right: "0",
                  background: "white",
                  border: "3px solid #FF69B4",
                  borderTop: "none",
                  borderRadius: "0 0 15px 15px",
                  maxHeight: "200px",
                  overflowY: "auto",
                  zIndex: 1000,
                  boxShadow: "0 5px 15px rgba(255, 105, 180, 0.3)"
                }}>
                  {filteredNames.map((name, index) => (
                    <div
                      key={index}
                      style={{
                        padding: "10px 15px",
                        cursor: "pointer",
                        borderBottom: index < filteredNames.length - 1 ? "1px solid #FFE4E1" : "none",
                        color: "#FF1493",
                        fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif"
                      }}
                      onMouseDown={() => handleNameSelect(name)}
                      onMouseOver={(e) => {
                        e.target.style.backgroundColor = "#FFE4E1";
                      }}
                      onMouseOut={(e) => {
                        e.target.style.backgroundColor = "white";
                      }}
                    >
                      {name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Player Info Display */}
          {playerInfo && playerInfo.isActive && (
            <div className="player-info-card" style={{
              background: "linear-gradient(45deg, #32CD32, #228B22)",
              borderRadius: "20px",
              padding: "25px",
              margin: "30px 0",
              textAlign: "center",
              color: "white",
              fontSize: "1.2em",
              fontWeight: "bold",
              textShadow: "2px 2px 4px rgba(0, 0, 0, 0.3)",
              boxShadow: "0 10px 30px rgba(50, 205, 50, 0.4)",
              border: "3px solid #228B22"
            }}>
              <div className="player-name-title" style={{ fontSize: "1.5em", marginBottom: "15px" }}>
                🏆 {playerInfo.name} 🏆
              </div>
              <div className="player-rating" style={{ fontSize: "1.3em", marginBottom: "10px" }}>
                Rating: {playerInfo.rating} | {playerInfo.gender === 'F' ? '👧 Girl' : '👦 Boy'}
              </div>
              <div className="percentile-text" style={{ fontSize: "1.4em", marginBottom: "10px" }}>
                🎯 You're in the top {playerInfo.percentile}% of players! 🎯
              </div>
              <div style={{ fontSize: "1em", opacity: 0.9 }}>
                Last played: {playerInfo.lastPlayed}
              </div>
            </div>
          )}

          {/* Inactive Player Warning */}
          {playerInfo && !playerInfo.isActive && (
            <div className="player-info-card" style={{
              background: "linear-gradient(45deg, #FFB347, #FF8C00)",
              borderRadius: "20px",
              padding: "25px",
              margin: "30px 0",
              textAlign: "center",
              color: "white",
              fontSize: "1.2em",
              fontWeight: "bold",
              textShadow: "2px 2px 4px rgba(0, 0, 0, 0.3)",
              boxShadow: "0 10px 30px rgba(255, 179, 71, 0.4)",
              border: "3px solid #FF8C00"
            }}>
              <div style={{ fontSize: "3em", marginBottom: "15px" }}>
                😴
              </div>
              <div className="player-name-title" style={{ fontSize: "1.5em", marginBottom: "15px" }}>
                {playerInfo.name}
              </div>
              <div className="player-rating" style={{ fontSize: "1.3em", marginBottom: "15px" }}>
                Rating: {playerInfo.rating} | {playerInfo.gender === 'F' ? '👧 Girl' : '👦 Boy'}
              </div>
              <div className="inactive-warning" style={{ fontSize: "1.2em", marginBottom: "15px", lineHeight: "1.4" }}>
                {'(˘▾˘~)'} Oops! This player hasn't been active in the last{' '}
                {months === '' || months === '0' ? 'many' : months} month{months !== '1' ? 's' : ''}
              </div>
              <div style={{ fontSize: "1.1em", marginBottom: "15px" }}>
                Last played: {playerInfo.lastPlayed}
              </div>
              <div style={{ fontSize: "1em", opacity: 0.9, fontStyle: "italic" }}>
                Try increasing the time period to see their ranking! ✨
              </div>
            </div>
          )}
          
          <div className="total-players" style={{
            background: "linear-gradient(45deg, #FF69B4, #FF1493)",
            borderRadius: "20px",
            padding: "20px",
            margin: "30px 0",
            textAlign: "center",
            color: "white",
            fontSize: "1.5em",
            fontWeight: "bold",
            textShadow: "2px 2px 4px rgba(0, 0, 0, 0.3)",
            boxShadow: "0 10px 30px rgba(255, 105, 180, 0.4)"
          }}>
            🌟 Total active players: {activePlayerCount} 🌟
            <div style={{ fontSize: "0.8em", marginTop: "10px", opacity: "0.9" }}>
              {selectedGender === 'all' ? 'All genders' : 
               selectedGender === 'F' ? 'Girls only' : 'Boys only'}
            </div>
          </div>
          
          {hist.length > 0 ? (
            <div className="chart-container" style={{
              background: "white",
              borderRadius: "25px",
              padding: "30px",
              border: "4px solid #FF69B4",
              boxShadow: "0 15px 35px rgba(255, 105, 180, 0.3)"
            }}>
              <h3 className="chart-title" style={{
                textAlign: "center",
                color: "#FF1493",
                fontSize: "2em",
                marginBottom: "30px",
                textShadow: "2px 2px 4px rgba(255, 20, 147, 0.3)"
              }}>
                📊 Rating Distribution Magic ✨
              </h3>
              <ResponsiveContainer width="100%" height={450}>
                <BarChart data={hist}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#FFB6C1" />
                  <XAxis 
                    dataKey="range" 
                    tick={{ fill: '#FF1493', fontSize: 12, fontFamily: "'Comic Sans MS', cursive" }}
                    axisLine={{ stroke: '#FF69B4', strokeWidth: 2 }}
                  />
                  <YAxis 
                    allowDecimals={false} 
                    tick={{ fill: '#FF1493', fontSize: 12, fontFamily: "'Comic Sans MS', cursive" }}
                    axisLine={{ stroke: '#FF69B4', strokeWidth: 2 }}
                  />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: '#FFE4E1',
                      border: '3px solid #FF69B4',
                      borderRadius: '15px',
                      fontFamily: "'Fredoka', 'Bubblegum Sans', cursive",
                      color: '#FF1493',
                      fontSize: '1.1em'
                    }}
                  />
                  <Bar 
                    dataKey="count" 
                    fill="url(#colorGradient)"
                    radius={[8, 8, 0, 0]}
                  />
                  {/* Player Rating Reference Line */}
                  {playerInfo && calculatePercentileLine() && (
                    <ReferenceLine 
                      x={calculatePercentileLine().binRange}
                      stroke="#32CD32"
                      strokeWidth={4}
                      strokeDasharray="5 5"
                      label={{ 
                        value: `🏆 ${playerInfo.name} (${playerInfo.rating})`, 
                        position: "top",
                        style: { 
                          fill: '#32CD32', 
                          fontWeight: 'bold',
                          fontSize: '14px',
                          fontFamily: "'Fredoka', 'Bubblegum Sans', cursive"
                        }
                      }}
                    />
                  )}
                  <defs>
                    <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FF1493" />
                      <stop offset="50%" stopColor="#FF69B4" />
                      <stop offset="100%" stopColor="#FFB6C1" />
                    </linearGradient>
                  </defs>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{
              background: "linear-gradient(45deg, #FFE4E1, #FFB6C1)",
              borderRadius: "25px",
              padding: "40px",
              border: "3px solid #FF69B4",
              textAlign: "center",
              boxShadow: "0 10px 30px rgba(255, 182, 193, 0.3)"
            }}>
              <div style={{ fontSize: "4em", marginBottom: "20px" }}>😅</div>
              <h3 style={{ color: "#FF1493", fontSize: "1.8em", marginBottom: "15px" }}>
                Oops! No data found for this time period!
              </h3>
              <p style={{ color: "#FF69B4", fontSize: "1.2em", lineHeight: "1.6" }}>
                Try increasing the number of months or check if data is available in the Google Sheet! ✨
              </p>
              <div style={{ fontSize: "2em", marginTop: "20px" }}>🔍📊</div>
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