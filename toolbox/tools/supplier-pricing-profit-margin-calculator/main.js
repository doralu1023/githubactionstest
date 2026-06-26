document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements Cache
    const tiersContainer = document.getElementById('tiers-container');
    const addTierBtn = document.getElementById('add-tier-btn');
    const calculateBtn = document.getElementById('calculate-btn');
    const validationMessage = document.getElementById('validation-message');
    const resultsCard = document.getElementById('results-card');
    const resultsBody = document.getElementById('results-body');

    // State Variables
    let tierCount = 0;
    const maxTiers = 5;
    let chartInstance = null;

    // Initialization
    addTier(); // Start with at least 1 tier input available

    // Event Listeners (Strict compliance: No inline handlers)
    addTierBtn.addEventListener('click', () => {
        if (tierCount < maxTiers) {
            addTier();
        }
    });

    calculateBtn.addEventListener('click', handleCalculation);

    /**
     * Adds a new tier input row to the matrix.
     */
    function addTier() {
        tierCount++;
        const tierRow = document.createElement('div');
        tierRow.className = 'tier-row';
        
        const unitsInput = document.createElement('input');
        unitsInput.type = 'number';
        unitsInput.placeholder = 'Max Units (e.g., 100)';
        unitsInput.min = '1';
        unitsInput.className = 'tier-units';

        const priceInput = document.createElement('input');
        priceInput.type = 'number';
        priceInput.placeholder = 'Tier Price ($)';
        priceInput.min = '0';
        priceInput.step = '0.01';
        priceInput.className = 'tier-price';

        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn btn-danger';
        removeBtn.textContent = 'Remove';
        removeBtn.title = 'Remove Tier';
        
        removeBtn.addEventListener('click', () => {
            tierRow.remove();
            tierCount--;
            updateAddButtonState();
        });

        tierRow.appendChild(unitsInput);
        tierRow.appendChild(priceInput);
        tierRow.appendChild(removeBtn);

        tiersContainer.appendChild(tierRow);
        updateAddButtonState();
    }

    /**
     * Manages the state of the "Add Tier" button.
     */
    function updateAddButtonState() {
        addTierBtn.disabled = tierCount >= maxTiers;
    }

    /**
     * Executes validation, calculation, and UI rendering logic.
     */
    function handleCalculation() {
        let isValid = true;
        validationMessage.classList.add('hidden');
        
        // 1. Validation Logic
        const allInputs = document.querySelectorAll('input[type="number"]');
        allInputs.forEach(input => {
            input.classList.remove('error-highlight');
            const val = parseFloat(input.value);
            
            // Check for empty fields or negative numbers
            if (input.value === '' || isNaN(val) || val < 0) {
                isValid = false;
                input.classList.add('error-highlight');
            }
        });

        if (!isValid) {
            validationMessage.classList.remove('hidden');
            resultsCard.classList.add('hidden');
            return;
        }

        // 2. Data Extraction
        const baseCost = parseFloat(document.getElementById('base-cost').value);
        const shippingCost = parseFloat(document.getElementById('shipping-cost').value);
        const tariffRate = parseFloat(document.getElementById('tariff-rate').value) / 100;

        const tierRows = document.querySelectorAll('.tier-row');
        const results = [];

        // 3. Formula Execution
        tierRows.forEach((row) => {
            const units = parseFloat(row.querySelector('.tier-units').value);
            const price = parseFloat(row.querySelector('.tier-price').value);

            // Total Cost = Base Cost + (Shipping / Units) * (1 + Tariff%).
            const totalCost = baseCost + (shippingCost / units) * (1 + tariffRate);
            
            // Net Margin % = ((Tier Price - Total Cost) / Tier Price) * 100
            let netMargin = 0;
            if (price > 0) {
                netMargin = ((price - totalCost) / price) * 100;
            } else {
                netMargin = -100; // Represents 100% loss on free tier
            }

            results.push({
                units: units,
                price: price,
                totalCost: totalCost,
                netMargin: netMargin
            });
        });

        // 4. Render Updates
        renderTable(results);
        renderChart(results);
    }

    /**
     * Renders the matrix calculations into the results table.
     * @param {Array} results - Calculated tier data.
     */
    function renderTable(results) {
        resultsBody.innerHTML = '';
        
        results.forEach(result => {
            const tr = document.createElement('tr');

            const tdUnits = document.createElement('td');
            tdUnits.textContent = result.units;

            const tdPrice = document.createElement('td');
            tdPrice.textContent = `$${result.price.toFixed(2)}`;

            const tdTotalCost = document.createElement('td');
            tdTotalCost.textContent = `$${result.totalCost.toFixed(2)}`;

            const tdMargin = document.createElement('td');
            tdMargin.textContent = `${result.netMargin.toFixed(2)}%`;

            // Optional Feature: Margin Visual Indicators
            if (result.netMargin > 20) {
                tdMargin.classList.add('margin-high');
            } else if (result.netMargin < 5) {
                tdMargin.classList.add('margin-low');
            }

            tr.appendChild(tdUnits);
            tr.appendChild(tdPrice);
            tr.appendChild(tdTotalCost);
            tr.appendChild(tdMargin);

            resultsBody.appendChild(tr);
        });

        resultsCard.classList.remove('hidden');
    }

    /**
     * Initializes and renders the Chart.js visual overview if the local vendor file is loaded.
     * @param {Array} results - Calculated tier data.
     */
    function renderChart(results) {
        // Safe check for the locally bundled library
        if (typeof Chart === 'undefined') {
            console.warn('Chart.js vendor file is missing. Chart rendering skipped.');
            return;
        }

        const canvas = document.getElementById('marginChart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const labels = results.map(r => `Tier: ${r.units} Units`);
        const data = results.map(r => r.netMargin.toFixed(2));

        // Color coding mapped to optional visual indicator rules
        const bgColors = results.map(r => {
            if (r.netMargin > 20) return 'rgba(40, 167, 69, 0.6)';  // Success Green
            if (r.netMargin < 5) return 'rgba(220, 53, 69, 0.6)';   // Danger Red
            return 'rgba(0, 86, 179, 0.6)';                         // Primary Blue
        });

        const borderColors = results.map(r => {
            if (r.netMargin > 20) return 'rgba(40, 167, 69, 1)';
            if (r.netMargin < 5) return 'rgba(220, 53, 69, 1)';
            return 'rgba(0, 86, 179, 1)';
        });

        if (chartInstance) {
            chartInstance.destroy();
        }

        chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Net Margin (%)',
                    data: data,
                    backgroundColor: bgColors,
                    borderColor: borderColors,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Margin (%)'
                        }
                    }
                }
            }
        });
    }
});