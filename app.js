// Global variables
let csvData = null;
let debugMode = false; // Set to true for debugging

// State abbreviation mapping
const stateAbbreviations = {
    'alabama': 'al', 'alaska': 'ak', 'arizona': 'az', 'arkansas': 'ar', 'california': 'ca',
    'colorado': 'co', 'connecticut': 'ct', 'delaware': 'de', 'florida': 'fl', 'georgia': 'ga',
    'hawaii': 'hi', 'idaho': 'id', 'illinois': 'il', 'indiana': 'in', 'iowa': 'ia',
    'kansas': 'ks', 'kentucky': 'ky', 'louisiana': 'la', 'maine': 'me', 'maryland': 'md',
    'massachusetts': 'ma', 'michigan': 'mi', 'minnesota': 'mn', 'mississippi': 'ms', 'missouri': 'mo',
    'montana': 'mt', 'nebraska': 'ne', 'nevada': 'nv', 'new hampshire': 'nh', 'new jersey': 'nj',
    'new mexico': 'nm', 'new york': 'ny', 'north carolina': 'nc', 'north dakota': 'nd', 'ohio': 'oh',
    'oklahoma': 'ok', 'oregon': 'or', 'pennsylvania': 'pa', 'rhode island': 'ri', 'south carolina': 'sc',
    'south dakota': 'sd', 'tennessee': 'tn', 'texas': 'tx', 'utah': 'ut', 'vermont': 'vt',
    'virginia': 'va', 'washington': 'wa', 'west virginia': 'wv', 'wisconsin': 'wi', 'wyoming': 'wy'
};

const reverseStateMap = {};
Object.keys(stateAbbreviations).forEach(name => {
    const abbrev = stateAbbreviations[name];
    reverseStateMap[abbrev] = name;
});

// Utility functions
function normalizeState(state) {
    if (!state) return '';
    const lower = state.toLowerCase().trim();
    return stateAbbreviations[lower] || lower;
}

function getFullStateName(state) {
    if (!state) return '';
    const lower = state.toLowerCase().trim();
    if (reverseStateMap[lower]) {
        return reverseStateMap[lower].split(' ').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
    }
    return state;
}

// Enhanced CSV parser
function parseCSV(text) {
    try {
        const lines = text.split(/\r?\n/).filter(line => line.trim());
        if (lines.length < 2) {
            throw new Error('CSV must have at least a header row and one data row');
        }

        const result = [];
        
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            const row = [];
            let current = '';
            let inQuotes = false;
            
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const nextChar = line[i + 1];
                
                if (char === '"') {
                    if (inQuotes && nextChar === '"') {
                        current += '"';
                        i++; // Skip next quote
                    } else {
                        inQuotes = !inQuotes;
                    }
                } else if (char === ',' && !inQuotes) {
                    row.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            row.push(current.trim()); // Add last field
            result.push(row);
        }
        
        // Convert to objects with proper data types
        const headers = result[0].map(h => h.trim());
        const data = [];
        
        for (let i = 1; i < result.length; i++) {
            const row = {};
            headers.forEach((header, index) => {
                let value = result[i][index] || '';
                value = String(value).trim();
                
                // Convert numeric values
                if (value && !isNaN(value) && value !== '') {
                    const num = parseFloat(value);
                    if (!isNaN(num) && isFinite(num)) {
                        value = num;
                    }
                }
                
                row[header] = value;
            });
            
            // Only add rows that have a lender name
            if (row['Lender Name'] && String(row['Lender Name']).trim()) {
                data.push(row);
            }
        }
        
        return data;
    } catch (error) {
        throw new Error(`CSV parsing failed: ${error.message}`);
    }
}

// Validation functions
function checkCustomRestrictions(lender, criteria) {
    const lenderName = String(lender['Lender Name'] || '').toLowerCase();
    const merchantIndustry = criteria.industry.toLowerCase();
    
    // Lexio Capital: Trucking 1st-2nd position only
    if (lenderName.includes('lexio') && 
        (merchantIndustry.includes('truck') || merchantIndustry.includes('transport')) &&
        criteria.requestedPosition >= 3) {
        return 'Industry - Trucking 1st-2nd position only';
    }
    
    // FynCap: No trucking in IL
    if (lenderName.includes('fyncap') &&
        (merchantIndustry.includes('truck') || merchantIndustry.includes('transport')) &&
        normalizeState(criteria.state) === 'il') {
        return 'Industry - Trucking not accepted in IL';
    }
    
    // Blackbridge: No trucking in IL
    if (lenderName.includes('blackbridge') &&
        (merchantIndustry.includes('truck') || merchantIndustry.includes('transport')) &&
        normalizeState(criteria.state) === 'il') {
        return 'Industry - Trucking not accepted in IL';
    }
    
    // The Smarter Merchant: No sole props in specific states
    if (lenderName.includes('smarter merchant') &&
        criteria.isSoleProp &&
        ['il', 'ar', 'ny'].includes(normalizeState(criteria.state))) {
        return `Industry - Sole props not accepted in ${criteria.state}`;
    }
    
    // Idea Financial: Construction requires 7+ years TIB
    if (lenderName.includes('idea financial') &&
        merchantIndustry.includes('construction') &&
        criteria.tib < 84) { // 7 years = 84 months
        return 'Industry - Construction requires 7+ years TIB';
    }
    
    return null;
}

function checkStateRestrictions(lender, criteria) {
    const stateRestrictions = String(lender['State_Restrictions'] || '');
    if (!stateRestrictions) return null;
    
    const merchantState = criteria.state.trim();
    const fullStateName = getFullStateName(merchantState);
    
    // Check both abbreviation and full name
    if (stateRestrictions.includes(merchantState) || 
        stateRestrictions.includes(fullStateName)) {
        return `State - ${stateRestrictions}`;
    }
    
    return null;
}

function checkSolePropRestrictions(lender) {
    const requirements = String(lender['Other_Key_Requirements'] || '').toLowerCase();
    const prohibited = String(lender['Prohibited_Industries'] || '').toLowerCase();
    const allText = requirements + ' ' + prohibited;
    
    if (allText.includes('no sole prop') || 
        allText.includes('corp only') || 
        allText.includes('sole props')) {
        return 'Sole Prop - Not accepted';
    }
    
    return null;
}

function checkIndustryRestrictions(lender, criteria) {
    const prohibited = String(lender['Prohibited_Industries'] || '').toLowerCase();
    if (!prohibited) return null;
    
    const merchantIndustry = criteria.industry.toLowerCase();
    
    // Simple keyword matching
    const industryKeywords = merchantIndustry.split(/[\s\/,]+/);
    for (const keyword of industryKeywords) {
        if (keyword.length > 3 && prohibited.includes(keyword) && 
            !prohibited.includes('case by case')) {
            return `Industry - ${lender['Prohibited_Industries']}`;
        }
    }
    
    return null;
}

function checkMinimumRequirements(lender, criteria) {
    // Min TIB
    const minTib = parseFloat(lender['Min_TIB_Months']);
    if (!isNaN(minTib) && criteria.tib < minTib) {
        return `TIB - Min ${minTib} months`;
    }

    // Min Revenue
    const minRevenue = parseFloat(lender['Min_Monthly_Revenue']);
    if (!isNaN(minRevenue) && criteria.monthlyRevenue < minRevenue) {
        return `Revenue - Min $${minRevenue.toLocaleString()}`;
    }

    // Min FICO (with 20 point tolerance)
    const minFico = parseFloat(lender['Min_FICO']);
    if (!isNaN(minFico) && criteria.fico < (minFico - 20)) {
        return `FICO - Min ${minFico} (with 20pt tolerance)`;
    }

    return null;
}

// Processing functions
function processLenders(criteria) {
    let qualifiedLenders = [];
    let nonQualifiedLenders = [];
    let autoDroppedCount = 0;
    let processingErrors = [];

    if (!csvData || csvData.length === 0) {
        displayError('No CSV data loaded');
        return;
    }

    csvData.forEach((lender, index) => {
        try {
            const lenderName = String(lender['Lender Name'] || '').trim();
            
            // Skip empty or invalid lender names
            if (!lenderName || lenderName.length < 2) {
                autoDroppedCount++;
                return;
            }

            // Skip obviously invalid rows
            if (lenderName.includes('$') || lenderName.match(/^\d+$/) || 
                lenderName.toLowerCase().includes('total') ||
                lenderName.toLowerCase().includes('summary')) {
                autoDroppedCount++;
                return;
            }

            let blockingRule = null;

            // Position check
            const posMin = parseFloat(lender['pos_min']);
            const posMax = parseFloat(lender['pos_max']);
            
            if (isNaN(posMin) || isNaN(posMax)) {
                autoDroppedCount++;
                return;
            }

            if (criteria.requestedPosition < posMin || criteria.requestedPosition > posMax) {
                const positionInfo = `Positions ${posMin}-${posMax}`;
                blockingRule = `Position - ${positionInfo}`;
            }

            // Check various restrictions
            if (!blockingRule) blockingRule = checkCustomRestrictions(lender, criteria);
            if (!blockingRule) blockingRule = checkStateRestrictions(lender, criteria);
            if (!blockingRule && criteria.isSoleProp) blockingRule = checkSolePropRestrictions(lender);
            if (!blockingRule) blockingRule = checkIndustryRestrictions(lender, criteria);
            if (!blockingRule) blockingRule = checkMinimumRequirements(lender, criteria);

            // Final classification
            if (blockingRule) {
                nonQualifiedLenders.push({ 
                    lender: lenderName, 
                    blockingRule: blockingRule 
                });
            } else {
                qualifiedLenders.push(lender);
            }

        } catch (error) {
            processingErrors.push(`Row ${index + 1}: ${error.message}`);
            autoDroppedCount++;
        }
    });

    if (processingErrors.length > 0 && debugMode) {
        console.warn('Processing errors:', processingErrors);
    }

    displayResults(qualifiedLenders, nonQualifiedLenders, autoDroppedCount, processingErrors);
}

// Display functions
function displayResults(qualified, nonQualified, autoDropped, errors = []) {
    const resultsDiv = document.getElementById('results');
    let html = '';

    // Summary
    html += `
        <div class="summary">
            <div class="summary-item">
                <div class="summary-number">${qualified.length}</div>
                <div class="summary-label">Qualified</div>
            </div>
            <div class="summary-item">
                <div class="summary-number">${nonQualified.length}</div>
                <div class="summary-label">Non-Qualified</div>
            </div>
            <div class="summary-item">
                <div class="summary-number">${autoDropped}</div>
                <div class="summary-label">Auto-Dropped</div>
            </div>
        </div>
    `;

    // Debug info
    if (debugMode && errors.length > 0) {
        html += `
            <div class="debug-info">
                <strong>Processing Errors:</strong><br>
                ${errors.join('<br>')}
            </div>
        `;
    }

    // Qualified lenders
    if (qualified.length === 0) {
        html += `
            <div class="results-section">
                <h3>📋 Results</h3>
                <p>No qualified lenders found. Please check your criteria or CSV data.</p>
            </div>
        `;
    } else {
        // Group by tier
        const tierGroups = {};
        qualified.forEach(lender => {
            const tier = String(lender['Tier'] || 'Unknown').trim();
            if (!tierGroups[tier]) tierGroups[tier] = [];
            tierGroups[tier].push(lender);
        });

        // Sort tiers
        const sortedTiers = Object.keys(tierGroups).sort((a, b) => {
            if (a === 'Unknown') return 1;
            if (b === 'Unknown') return -1;
            
            const aNum = parseInt(a);
            const bNum = parseInt(b);
            
            if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
            if (!isNaN(aNum)) return -1;
            if (!isNaN(bNum)) return 1;
            
            return a.localeCompare(b);
        });

        html += `<div class="results-section"><h3>✅ Qualified Lenders</h3>`;
        
        sortedTiers.forEach(tier => {
            const tierLabel = tier === 'Unknown' ? 'No Tier Specified' : `Tier ${tier}`;
            html += `
                <div class="tier-group">
                    <div class="tier-title">${tierLabel}</div>
                    <div class="lender-list">
            `;
            
            tierGroups[tier]
                .sort((a, b) => String(a['Lender Name']).localeCompare(String(b['Lender Name'])))
                .forEach(lender => {
                    const lenderName = String(lender['Lender Name']).trim();
                    html += `<div class="lender-item">${lenderName}</div>`;
                });
            
            html += `</div></div>`;
        });
        
        html += `</div>`;
    }

    // Non-qualified lenders
    if (nonQualified.length > 0) {
        html += `
            <div class="results-section">
                <h3>❌ Non-Qualified Lenders</h3>
        `;
        
        nonQualified
            .sort((a, b) => a.lender.localeCompare(b.lender))
            .forEach(item => {
                html += `
                    <div class="non-qualified-item">
                        <div class="lender-name">${item.lender}</div>
                        <div class="blocking-reason">${item.blockingRule}</div>
                    </div>
                `;
            });
        
        html += `</div>`;
    }

    resultsDiv.innerHTML = html;
    resultsDiv.style.display = 'block';
    resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function displayError(message) {
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = `
        <div class="results-section">
            <div class="status error">
                ❌ ${message}
            </div>
        </div>
    `;
    resultsDiv.style.display = 'block';
}

function updateProcessButton() {
    const btn = document.getElementById('processBtn');
    
    // Check if all required fields are filled
    const position = document.getElementById('position').value;
    const tib = document.getElementById('tib').value;
    const revenue = document.getElementById('revenue').value;
    const fico = document.getElementById('fico').value;
    const state = document.getElementById('state').value.trim();
    const industry = document.getElementById('industry').value.trim();
    
    const isFormValid = position && tib && revenue && fico && state && industry;
    btn.disabled = !csvData || !isFormValid;
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    // File upload handling
    document.getElementById('csvFile').addEventListener('change', function(e) {
        const file = e.target.files[0];
        const status = document.getElementById('fileStatus');
        
        if (!file) {
            csvData = null;
            updateProcessButton();
            return;
        }
        
        if (!file.name.toLowerCase().endsWith('.csv')) {
            status.textContent = '❌ Please select a CSV file';
            status.className = 'status error';
            status.style.display = 'block';
            csvData = null;
            updateProcessButton();
            return;
        }
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                csvData = parseCSV(e.target.result);
                status.textContent = `✅ Loaded ${csvData.length} lenders successfully`;
                status.className = 'status success';
                status.style.display = 'block';
                
                if (debugMode) {
                    console.log('CSV Headers:', Object.keys(csvData[0] || {}));
                    console.log('Sample row:', csvData[0]);
                }
                
                updateProcessButton();
            } catch (error) {
                status.textContent = `❌ Error loading file: ${error.message}`;
                status.className = 'status error';
                status.style.display = 'block';
                csvData = null;
                updateProcessButton();
            }
        };
        reader.onerror = function() {
            status.textContent = '❌ Error reading file';
            status.className = 'status error';
            status.style.display = 'block';
            csvData = null;
            updateProcessButton();
        };
        reader.readAsText(file);
    });

    // Form validation
    document.getElementById('merchantForm').addEventListener('input', updateProcessButton);
    document.getElementById('merchantForm').addEventListener('change', updateProcessButton);

    // Process button
    document.getElementById('processBtn').addEventListener('click', function() {
        try {
            const merchantCriteria = {
                requestedPosition: parseInt(document.getElementById('position').value),
                tib: parseInt(document.getElementById('tib').value),
                monthlyRevenue: parseInt(document.getElementById('revenue').value),
                fico: parseInt(document.getElementById('fico').value),
                state: document.getElementById('state').value.trim(),
                industry: document.getElementById('industry').value.trim(),
                isSoleProp: document.getElementById('soleProp').checked
            };

            // Validate inputs
            if (isNaN(merchantCriteria.requestedPosition) || merchantCriteria.requestedPosition < 1 || merchantCriteria.requestedPosition > 10) {
                throw new Error('Invalid position selected');
            }
            if (isNaN(merchantCriteria.tib) || merchantCriteria.tib < 0) {
                throw new Error('Invalid time in business');
            }
            if (isNaN(merchantCriteria.monthlyRevenue) || merchantCriteria.monthlyRevenue < 0) {
                throw new Error('Invalid monthly revenue');
            }
            if (isNaN(merchantCriteria.fico) || merchantCriteria.fico < 300 || merchantCriteria.fico > 850) {
                throw new Error('Invalid FICO score (must be 300-850)');
            }

            processLenders(merchantCriteria);
        } catch (error) {
            displayError(`Processing error: ${error.message}`);
        }
    });

    // Input validation styling
    document.getElementById('fico').addEventListener('input', function(e) {
        const value = parseInt(e.target.value);
        if (value && (value < 300 || value > 850)) {
            e.target.style.borderColor = '#ef4444';
        } else {
            e.target.style.borderColor = '#e5e7eb';
        }
    });

    document.getElementById('revenue').addEventListener('input', function(e) {
        const value = parseInt(e.target.value);
        if (value && value < 0) {
            e.target.style.borderColor = '#ef4444';
        } else {
            e.target.style.borderColor = '#e5e7eb';
        }
    });

    document.getElementById('tib').addEventListener('input', function(e) {
        const value = parseInt(e.target.value);
        if (value && value < 0) {
            e.target.style.borderColor = '#ef4444';
        } else {
            e.target.style.borderColor = '#e5e7eb';
        }
    });

    // Initialize
    updateProcessButton();
});