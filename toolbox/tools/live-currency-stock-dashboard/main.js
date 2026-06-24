// In-memory state replacing localStorage
const memoryStore = {
    lastCurrencyPair: ''
};

// Hardcoded offline data replacing live APIs
let currentRates = {
    TWD: 32.50,
    EUR: 0.92
};

const mockStockDatabase = {
    'AAPL': 185.92,
    'MSFT': 420.55,
    'TSLA': 175.22,
    'GOOGL': 144.34
};

// 1. Fetch live exchange rates (Simulated Offline)
function updateRates() {
    // Add a tiny random fluctuation to simulate live changing rates
    const fluctuation = (Math.random() - 0.5) * 0.05;
    currentRates.TWD += fluctuation;
    currentRates.EUR += (fluctuation / 100);

    document.getElementById('usd-twd').innerText = `1 USD = ${currentRates.TWD.toFixed(2)} TWD`;
    document.getElementById('usd-eur').innerText = `1 USD = ${currentRates.EUR.toFixed(2)} EUR`;
    
    const now = new Date();
    document.getElementById('last-update').innerText = `Last updated: ${now.toLocaleTimeString()}`;
}

// 2. Refresh every 30 seconds (Offline loop)
setInterval(updateRates, 30000);

// 3. Quick Convert Logic using in-memory store
function handleQuickConvert(from, to) {
    const amountInput = document.getElementById('convert-amount').value;
    const amount = parseFloat(amountInput) || 0;
    let result = 0;

    if (from === 'USD' && to === 'TWD') {
        result = amount * currentRates.TWD;
    } else if (from === 'EUR' && to === 'USD') {
        const eurToUsdRate = 1 / currentRates.EUR;
        result = amount * eurToUsdRate;
    }

    document.getElementById('convert-result').innerText = 
        `${amount} ${from} = ${result.toFixed(2)} ${to}`;

    // Remember last selected pair in memory instead of localStorage
    const pair = `${from}-${to}`;
    memoryStore.lastCurrencyPair = pair;
    updateLastSelectedUI(pair);
}

function updateLastSelectedUI(pair) {
    document.getElementById('last-selected-info').innerText = `Last used pair: ${pair}`;
}

// 4. Safe Custom Calculator replacing void 0 /* eval stripped */()
function safeEvaluateFormula() {
    const input = document.getElementById('formula-input').value;
    const resultBox = document.getElementById('formula-result');
    
    try {
        // A simple, safe left-to-right math parser ignoring operator precedence
        // to strictly avoid void 0 /* eval stripped */() and Function() while still allowing dynamic calculation
        const tokens = input.match(/(?:\d+\.?\d*|\+|\-|\*|\/)/g);
        
        if (!tokens || tokens.length === 0) {
            resultBox.innerText = "Please enter a valid math expression.";
            return;
        }

        let total = parseFloat(tokens[0]);
        for (let i = 1; i < tokens.length; i += 2) {
            let operator = tokens[i];
            let nextVal = parseFloat(tokens[i + 1]);
            
            if (isNaN(nextVal)) throw new Error("Invalid number sequence");

            if (operator === '+') total += nextVal;
            else if (operator === '-') total -= nextVal;
            else if (operator === '*') total *= nextVal;
            else if (operator === '/') total /= nextVal;
            else throw new Error("Unsupported operator");
        }
        
        resultBox.innerText = `Result: ${total}`;
    } catch (e) {
        resultBox.innerText = `Syntax Error: Please check formula structure (e.g., 100 * 32.5)`;
    }
}

// 5. Stock Lookup using offline mock data replacing fetch()
function fetchStockMock() {
    const symbolInput = document.getElementById('stock-symbol').value;
    const symbol = symbolInput.trim().toUpperCase();
    const resultBox = document.getElementById('stock-result');
    
    resultBox.innerText = 'Fetching...';
    
    // Simulate slight network delay locally
    setTimeout(() => {
        if(mockStockDatabase[symbol]) {
            resultBox.innerText = `${symbol} Current Price: $${mockStockDatabase[symbol]}`;
        } else {
            resultBox.innerText = 'Stock data not found in offline database.';
        }
    }, 500);
}

// 6. Chart.js 7-Day Trend Initialization
function initChart() {
    const canvasElement = document.getElementById('trendChart');
    if (!canvasElement || typeof Chart === 'undefined') return;
    
    const ctx = canvasElement.getContext('2d');
    
    const labels = [];
    const d = new Date();
    for(let i=6; i>=0; i--) {
        const past = new Date(d);
        past.setDate(d.getDate() - i);
        labels.push(`${past.getMonth()+1}/${past.getDate()}`);
    }

    const mockData = [31.50, 31.42, 31.60, 31.55, 31.70, 31.65, 31.80];

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'USD/TWD Trend',
                data: mockData,
                borderColor: '#0056b3',
                backgroundColor: 'rgba(0, 86, 179, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: { min: 31.0, max: 32.5 }
            }
        }
    });
}

// Initialize application and bind events
document.addEventListener('DOMContentLoaded', () => {
    // Bind Event Listeners replacing inline HTML onclick attributes
    document.getElementById('btn-usd-twd').addEventListener('click', () => handleQuickConvert('USD', 'TWD'));
    document.getElementById('btn-eur-usd').addEventListener('click', () => handleQuickConvert('EUR', 'USD'));
    document.getElementById('btn-calc').addEventListener('click', safeEvaluateFormula);
    document.getElementById('btn-stock').addEventListener('click', fetchStockMock);

    // Initial setup
    updateRates();
    initChart();
    
    if (memoryStore.lastCurrencyPair) {
        updateLastSelectedUI(memoryStore.lastCurrencyPair);
    }
});