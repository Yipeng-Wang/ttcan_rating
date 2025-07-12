import React, { useEffect, useState } from "react";
// Chart imports removed - no longer using histogram

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
    typeof player.gender === 'string' && // Gender can be empty string
    (player.gender === 'F' || player.gender === 'M' || player.gender === '')
  );
}

// Histogram utilities removed

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
  const [months, setMonths] = useState('');
  const [data, setData] = useState([]);
  // Histogram removed
  const [activePlayerCount, setActivePlayerCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [playerName, setPlayerName] = useState('');
  const [playerInfo, setPlayerInfo] = useState(null);
  const [filteredNames, setFilteredNames] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedGender, setSelectedGender] = useState('all');
  const [genderCounts, setGenderCounts] = useState({ F: 0, M: 0 });
  const [selectedAge, setSelectedAge] = useState('all');
  const [selectedProvince, setSelectedProvince] = useState('all');
  const [provinceCounts, setProvinceCounts] = useState({});
  const [topPlayers, setTopPlayers] = useState([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);

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

  // Re-filter and update count when data, months, gender, age, or province changes
  useEffect(() => {
    try {
      // If months is empty or 0, show all data
      const monthsValue = months === '' || months === '0' ? 1000 : Number(months);
      let filtered = data.filter(x => isWithinLastNMonths(x.lastPlayed, monthsValue));
      
      // Apply gender filter
      if (selectedGender !== 'all') {
        filtered = filtered.filter(x => x.gender === selectedGender);
      }
      
      // Apply age filter
      if (selectedAge !== 'all') {
        filtered = filtered.filter(x => {
          const age = parseInt(x.age);
          if (isNaN(age) || age === 0) return false;
          
          switch (selectedAge) {
            case 'u9': return age <= 9;
            case 'u10': return age <= 10;
            case 'u11': return age <= 11;
            case 'u12': return age <= 12;
            case 'u13': return age <= 13;
            case 'u14': return age <= 14;
            case 'u15': return age <= 15;
            case 'u17': return age <= 17;
            case 'u19': return age <= 19;
            default: return true;
          }
        });
      }
      
      // Apply province filter
      if (selectedProvince !== 'all') {
        filtered = filtered.filter(x => x.province === selectedProvince);
      }
      
      setActivePlayerCount(filtered.length);
      
      // Update top 50 players list
      const sortedPlayers = filtered
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 50)
        .map((player, index) => ({
          ...player,
          rank: index + 1
        }));
      setTopPlayers(sortedPlayers);
      
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
            age: player.age,
            percentile: percentile,
            rank: playerRank,
            totalPlayers: ratings.length,
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
              age: playerInFullData.age,
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
  }, [months, data, playerName, selectedGender, selectedAge, selectedProvince]);

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
    setSelectedSuggestionIndex(-1); // Reset suggestion selection
    
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
      // When name is cleared, reset all filters to their default values
      setFilteredNames([]);
      setShowSuggestions(false);
      setPlayerInfo(null);
      setSelectedSuggestionIndex(-1);
      
      // Clear all filter values
      setSelectedProvince('all');
      setSelectedGender('all');
      setSelectedAge('all');
    }
  };

  const handleKeyDown = (e) => {
    if (!showSuggestions || filteredNames.length === 0) return;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSuggestionIndex(prev => 
        prev < filteredNames.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSuggestionIndex(prev => 
        prev > 0 ? prev - 1 : filteredNames.length - 1
      );
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
    
    // The useEffect will handle recalculating player info with the new filter values
  };

  // calculatePercentileLine function removed since histogram is gone

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
            🏓✨ TTCan Rating Search ✨🏓
          </h1>
          
          <p className="subtitle-text" style={{
            textAlign: "center",
            color: "#FF69B4",
            fontSize: "1.3em",
            marginBottom: "40px",
            fontStyle: "italic"
          }}>
            Discover the amazing world of Canadian table tennis ratings
          </p>

          {/* First Row: Player Name Input and Active Period */}
          <div className="input-section" style={{
            background: "linear-gradient(45deg, #f5f5f5, #e8e8e8)",
            borderRadius: "20px",
            padding: "25px",
            marginBottom: "20px",
            border: "3px solid #888888",
            boxShadow: "0 10px 25px rgba(128, 128, 128, 0.2)",
            position: "relative"
          }}>
            <div style={{ 
              display: "grid", 
              gridTemplateColumns: "2fr 1fr",
              gap: "30px",
              alignItems: "start"
            }}>
              {/* Player Name Input */}
              <div>
                <label style={{
                  display: "block",
                  fontSize: "1.3em",
                  color: "#444444",
                  fontWeight: "bold",
                  marginBottom: "15px",
                  textAlign: "center"
                }}>
                  Player Name
                </label>
                
                <div style={{ position: "relative", maxWidth: "400px", margin: "0 auto" }}>
                  <input
                    type="text"
                    value={playerName}
                    onChange={handleNameChange}
                    onKeyDown={handleKeyDown}
                    placeholder="Enter your name..."
                    className="name-input"
                    style={{
                      width: "100%",
                      padding: "15px",
                      fontSize: "1.1em",
                      borderRadius: "15px",
                      border: "3px solid #888888",
                      fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
                      color: "#444444",
                      background: "white",
                      boxShadow: "0 5px 15px rgba(128, 128, 128, 0.2)",
                      textAlign: "center"
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
                  
                  {/* Autocomplete Suggestions */}
                  {showSuggestions && filteredNames.length > 0 && (
                    <div className="autocomplete-suggestions" style={{
                      position: "absolute",
                      top: "100%",
                      left: "0",
                      right: "0",
                      background: "white",
                      border: "3px solid #888888",
                      borderTop: "none",
                      borderRadius: "0 0 15px 15px",
                      maxHeight: "200px",
                      overflowY: "auto",
                      zIndex: 1000,
                      boxShadow: "0 5px 15px rgba(128, 128, 128, 0.3)"
                    }}>
                      {filteredNames.map((name, index) => (
                        <div
                          key={index}
                          style={{
                            padding: "10px 15px",
                            cursor: "pointer",
                            borderBottom: index < filteredNames.length - 1 ? "1px solid #e8e8e8" : "none",
                            color: "#444444",
                            fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
                            backgroundColor: selectedSuggestionIndex === index ? "#e8f5e8" : "white"
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
                  fontSize: "1.3em",
                  color: "#444444",
                  fontWeight: "bold",
                  marginBottom: "15px",
                  textAlign: "center"
                }}>
                  🗓️ Active in Last
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", justifyContent: "center" }}>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={months}
                    onChange={handleMonthsChange}
                    placeholder="All"
                    style={{
                      width: "80px",
                      padding: "15px 12px",
                      fontSize: "1.1em",
                      borderRadius: "15px",
                      border: "3px solid #888888",
                      textAlign: "center",
                      fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
                      color: "#444444",
                      background: "white",
                      boxShadow: "0 5px 15px rgba(128, 128, 128, 0.2)"
                    }}
                  />
                  <span style={{ color: "#444444", fontSize: "1.1em", fontWeight: "bold" }}>months</span>
                </div>
                <div style={{ 
                  textAlign: "center", 
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
            borderRadius: "20px",
            padding: "25px",
            marginBottom: "30px",
            border: "3px solid #888888",
            boxShadow: "0 10px 25px rgba(128, 128, 128, 0.2)"
          }}>
            <div style={{ 
              display: "grid", 
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "20px",
              alignItems: "center"
            }}>
              {/* Province Filter */}
              <div className="filter-group">
                <label style={{
                  display: "block",
                  fontSize: "1.1em",
                  color: "#444444",
                  fontWeight: "bold",
                  marginBottom: "8px"
                }}>
                  🏛️ Province
                </label>
                <select
                  value={selectedProvince}
                  onChange={(e) => setSelectedProvince(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "12px",
                    fontSize: "1em",
                    borderRadius: "10px",
                    border: "2px solid #888888",
                    fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
                    color: "#444444",
                    background: "white",
                    cursor: "pointer"
                  }}
                >
                  <option value="all">All Provinces</option>
                  {Object.entries(provinceCounts)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([province, count]) => (
                      <option key={province} value={province}>
                        {province} ({count})
                      </option>
                    ))}
                </select>
              </div>

              {/* Gender Filter */}
              <div className="filter-group">
                <label style={{
                  display: "block",
                  fontSize: "1.1em",
                  color: "#444444",
                  fontWeight: "bold",
                  marginBottom: "8px"
                }}>
                  👫 Gender
                </label>
                <select
                  value={selectedGender}
                  onChange={(e) => setSelectedGender(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "12px",
                    fontSize: "1em",
                    borderRadius: "10px",
                    border: "2px solid #888888",
                    fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
                    color: "#444444",
                    background: "white",
                    cursor: "pointer"
                  }}
                >
                  <option value="all">All ({Object.values(genderCounts).reduce((sum, count) => sum + count, 0)})</option>
                  <option value="F">Girls ({genderCounts.F || 0})</option>
                  <option value="M">Boys ({genderCounts.M || 0})</option>
                </select>
              </div>

              {/* Age Filter */}
              <div className="filter-group">
                <label style={{
                  display: "block",
                  fontSize: "1.1em",
                  color: "#444444",
                  fontWeight: "bold",
                  marginBottom: "8px"
                }}>
                  🎂 Age
                </label>
                <select
                  value={selectedAge}
                  onChange={(e) => setSelectedAge(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "12px",
                    fontSize: "1em",
                    borderRadius: "10px",
                    border: "2px solid #888888",
                    fontFamily: "'Fredoka', 'Bubblegum Sans', cursive, sans-serif",
                    color: "#444444",
                    background: "white",
                    cursor: "pointer"
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

          {/* Player Info Display */}
          {playerInfo && (
            <div className="player-info-card" style={{
              background: playerInfo.isActive ? 
                "linear-gradient(45deg, #32CD32, #228B22)" : 
                "linear-gradient(45deg, #FFB347, #FF8C00)",
              borderRadius: "20px",
              padding: "25px",
              margin: "30px 0",
              textAlign: "center",
              color: "white",
              fontSize: "1.2em",
              fontWeight: "bold",
              textShadow: "2px 2px 4px rgba(0, 0, 0, 0.3)",
              boxShadow: playerInfo.isActive ? 
                "0 10px 30px rgba(50, 205, 50, 0.4)" : 
                "0 10px 30px rgba(255, 179, 71, 0.4)",
              border: playerInfo.isActive ? 
                "3px solid #228B22" : 
                "3px solid #FF8C00"
            }}>
              {!playerInfo.isActive && (
                <div style={{ fontSize: "3em", marginBottom: "15px" }}>
                  😴
                </div>
              )}
              
              <div className="player-name-title" style={{ fontSize: "1.5em", marginBottom: "15px" }}>
                {playerInfo.isActive ? `🏆 ${playerInfo.name} 🏆` : playerInfo.name}
              </div>
              
              <div className="player-rating" style={{ fontSize: "1.3em", marginBottom: "15px" }}>
                Rating: {playerInfo.rating} | {playerInfo.gender === 'F' ? '♀️ Girl' : '♂️ Boy'} | Age: {playerInfo.age || 'Unknown'}
              </div>

              {playerInfo.isActive ? (
                <>
                  <div className="percentile-text" style={{ fontSize: "1.4em", marginBottom: "10px" }}>
                    🎯 You're ranked #{playerInfo.rank} out of {playerInfo.totalPlayers} {
                      selectedGender === 'all' ? 'players' : 
                      selectedGender === 'F' ? 'girls' : 'boys'
                    } in {
                      selectedProvince !== 'all' ? selectedProvince : 'all provinces'
                    }, {
                      selectedAge !== 'all' ? selectedAge.toUpperCase() : 'all age categories'
                    }! 🎯
                    <br />
                    Last played: {playerInfo.lastPlayed}
                  </div>
                  <div style={{ fontSize: "1.1em", opacity: 0.9, marginTop: "10px" }}>
                    Total active players in last {months === '' || months === '0' ? 'all time' : `${months} month${months !== '1' ? 's' : ''}`}: {activePlayerCount}
                  </div>
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
          )}

          {/* Top 50 Players List */}
          <div className="top-players-section" style={{
            background: "linear-gradient(45deg, #e8f5e8, #d4f4d4)",
            borderRadius: "20px",
            padding: "25px",
            marginTop: "30px",
            border: "3px solid #4CAF50",
            boxShadow: "0 10px 25px rgba(76, 175, 80, 0.2)"
          }}>
            <h2 style={{
              textAlign: "center",
              color: "#2E7D32",
              fontSize: "2em",
              marginBottom: "20px",
              textShadow: "2px 2px 4px rgba(46, 125, 50, 0.3)"
            }}>
              🏆 Top 50 Players {selectedGender !== 'all' ? `(${selectedGender === 'F' ? 'Girls' : 'Boys'})` : ''}
              {selectedProvince !== 'all' ? ` in ${selectedProvince}` : ''}
              {selectedAge !== 'all' ? `, ${selectedAge.toUpperCase()}` : ''}
            </h2>
            
            <div className="top-players-table" style={{
              background: "white",
              borderRadius: "15px",
              overflow: "hidden",
              boxShadow: "0 5px 15px rgba(0, 0, 0, 0.1)"
            }}>
              {/* Table Header */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "60px 2fr 1fr 80px 100px 80px 120px",
                gap: "10px",
                padding: "15px",
                background: "linear-gradient(45deg, #4CAF50, #45a049)",
                color: "white",
                fontWeight: "bold",
                fontSize: "1em",
                textAlign: "center",
                alignItems: "center"
              }}>
                <div>Rank</div>
                <div>Name</div>
                <div>Province</div>
                <div>Gender</div>
                <div>Rating</div>
                <div>Age</div>
                <div>Last Played</div>
              </div>
              
              {/* Table Rows */}
              <div style={{ maxHeight: "600px", overflowY: "auto" }}>
                {topPlayers.map((player, index) => (
                  <div
                    key={`${player.name}-${player.rating}-${index}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "60px 2fr 1fr 80px 100px 80px 120px",
                      gap: "10px",
                      padding: "12px 15px",
                      borderBottom: index < topPlayers.length - 1 ? "1px solid #e8e8e8" : "none",
                      backgroundColor: index % 2 === 0 ? "#f9f9f9" : "white",
                      fontSize: "0.95em",
                      textAlign: "center",
                      alignItems: "center",
                      cursor: "pointer",
                      transition: "background-color 0.2s ease"
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.backgroundColor = "#e8f5e8";
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.backgroundColor = index % 2 === 0 ? "#f9f9f9" : "white";
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
                    <div style={{ textAlign: "left", fontWeight: "500", color: "#2E7D32" }}>
                      {player.name}
                    </div>
                    <div style={{ color: "#666" }}>
                      {player.province}
                    </div>
                    <div style={{ color: "#666" }}>
                      {player.gender || 'N/A'}
                    </div>
                    <div style={{ fontWeight: "bold", color: "#1976D2" }}>
                      {player.rating}
                    </div>
                    <div style={{ color: "#666" }}>
                      {player.age || 'N/A'}
                    </div>
                    <div style={{ color: "#666", fontSize: "0.9em" }}>
                      {player.lastPlayed}
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
          </div>
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