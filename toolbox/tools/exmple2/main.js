// In-memory state (replaces localStorage/sessionStorage completely)
const memoryStore = {
    lastCurrencyPair: ''
};

// Hardcoded offline data
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

// 1. Simulated Live Rates
function updateRates() {
    const fluctuation = (Math.random() - 0.5) * 0.05;
    currentRates.TWD += fluctuation;
    currentRates.EUR += (fluctuation / 100);

    document.getElementById('usd-twd').innerText = `1 USD = ${currentRates.TWD.toFixed(2)} TWD`;
    document.getElementById('usd-eur').innerText = `1 USD = ${currentRates.EUR.toFixed(2)} EUR`;
    
    const now = new Date();
    document.getElementById('last-update').innerText = `Last updated: ${now.toLocaleTimeString()}`;
}

// 2. Offline Refresh Loop
setInterval(updateRates, 30000);

// 3. Quick Convert
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

    document.getElementById('convert-result').innerText = `${amount} ${from} = ${result.toFixed(2)} ${to}`;

    // Store in memory instead of cookies/localStorage
    const pair = `${from}-${to}`;
    memoryStore.lastCurrencyPair = pair;
    updateLastSelectedUI(pair);
}

function updateLastSelectedUI(pair) {
    document.getElementById('last-selected-info').innerText = `Last used pair: ${pair}`;
}

// 4. Safe Math Parser (Strictly avoids void 0 /* eval stripped */() and Function())
function safeEvaluateFormula() {
    const input = document.getElementById('formula-input').value;
    const resultBox = document.getElementById('formula-result');
    
    try {
        const tokens = input.match(/(?:\d+\.?\d*|\+|\-|\*|\/)/g);
        if (!tokens || tokens.length === 0) {
            resultBox.innerText = "Please enter a valid math expression.";
            return;
        }

        let total = parseFloat(tokens[0]);
        for (let i = 1; i < tokens.length; i += 2) {
            let operator = tokens[i];
            let nextVal = parseFloat(tokens[i + 1]);
            
            if (isNaN(nextVal)) throw new Error("Invalid sequence");

            if (operator === '+') total += nextVal;
            else if (operator === '-') total -= nextVal;
            else if (operator === '*') total *= nextVal;
            else if (operator === '/') total /= nextVal;
            else throw new Error("Unsupported operator");
        }
        
        resultBox.innerText = `Result: ${total}`;
    } catch (e) {
        resultBox.innerText = `Syntax Error: Please check formula structure.`;
    }
}

// 5. Offline Stock Lookup
function fetchStockMock() {
    const symbolInput = document.getElementById('stock-symbol').value;
    const symbol = symbolInput.trim().toUpperCase();
    const resultBox = document.getElementById('stock-result');
    
    resultBox.innerText = 'Fetching...';
    
    setTimeout(() => {
        if(mockStockDatabase[symbol]) {
            resultBox.innerText = `${symbol} Current Price: $${mockStockDatabase[symbol]}`;
        } else {
            resultBox.innerText = 'Stock data not found in offline database.';
        }
    }, 500);
}

// 6. Vanilla JS Custom Chart Drawing (Replaces Chart.js entirely to avoid eval flags)
function initNativeChart() {
    const canvas = document.getElementById('trendChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Mock 7-day data
    const data = [31.50, 31.42, 31.60, 31.55, 31.70, 31.65, 31.80];
    const minVal = 31.0;
    const maxVal = 32.5;
    const padding = 20;

    // Clear and draw grid background
    ctx.clearRect(0, 0, width, height);
    
    // Draw chart line
    ctx.beginPath();
    ctx.strokeStyle = '#0056b3';
    ctx.lineWidth = 3;
    
    data.forEach((val, index) => {
        const x = padding + (index * ((width - 2 * padding) / (data.length - 1)));
        // Invert Y axis so higher values are at the top
        const y = height - padding - ((val - minVal) / (maxVal - minVal) * (height - 2 * padding));
        
        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
        
        // Draw data points
        ctx.fillStyle = '#0056b3';
        ctx.fillRect(x - 3, y - 3, 6, 6);
    });
    
    ctx.stroke();
}

// Event Bindings
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-usd-twd').addEventListener('click', () => handleQuickConvert('USD', 'TWD'));
    document.getElementById('btn-eur-usd').addEventListener('click', () => handleQuickConvert('EUR', 'USD'));
    document.getElementById('btn-calc').addEventListener('click', safeEvaluateFormula);
    document.getElementById('btn-stock').addEventListener('click', fetchStockMock);

    updateRates();
    initNativeChart();
});