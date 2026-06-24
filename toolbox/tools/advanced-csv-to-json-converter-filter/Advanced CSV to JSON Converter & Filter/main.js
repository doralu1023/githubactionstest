/**
 * Advanced CSV to JSON Converter & Filter - Core Application Engine Logic
 * Completely offline operation executing local parsing and safe extraction.
 */

(function () {
    'use strict';

    // State Container
    const appState = {
        rawHeaders: [],
        rawRows: [],
        filteredRows: [],
        paginatedRows: [],
        currentPage: 1,
        rowsPerPage: 100,
        maxFileSize: 5 * 1024 * 1024 // 5 Megabytes
    };

    // DOM Nodes Ecosystem
    const DOM = {
        dropZone: document.getElementById('dropZone'),
        fileInput: document.getElementById('fileInput'),
        fileInfo: document.getElementById('fileInfo'),
        fileName: document.getElementById('fileName'),
        fileSize: document.getElementById('fileSize'),
        removeFileBtn: document.getElementById('removeFileBtn'),
        workspace: document.getElementById('workspace'),
        statusFilter: document.getElementById('statusFilter'),
        hideEmptyColsCheckbox: document.getElementById('hideEmptyColsCheckbox'),
        exportJsonBtn: document.getElementById('exportJsonBtn'),
        copyClipboardBtn: document.getElementById('copyClipboardBtn'),
        visibleCount: document.getElementById('visibleCount'),
        totalCount: document.getElementById('totalCount'),
        tableHeader: document.getElementById('tableHeader'),
        tableBody: document.getElementById('tableBody'),
        noDataMessage: document.getElementById('noDataMessage'),
        currentPageNum: document.getElementById('currentPageNum'),
        totalPageNum: document.getElementById('totalPageNum'),
        prevPageBtn: document.getElementById('prevPageBtn'),
        nextPageBtn: document.getElementById('nextPageBtn'),
        themeToggle: document.getElementById('themeToggle')
    };

    // --- Wire up Event Handlers ---
    function initializeListeners() {
        // Theme Switcher
        DOM.themeToggle.addEventListener('click', toggleTheme);

        // Upload and Drag Interactivity
        DOM.dropZone.addEventListener('dragover', onDragOver);
        DOM.dropZone.addEventListener('dragleave', onDragLeave);
        DOM.dropZone.addEventListener('drop', onDrop);
        DOM.fileInput.addEventListener('change', onFileSelected);
        DOM.removeFileBtn.addEventListener('click', resetApplicationState);

        // Interactive Query Inputs
        DOM.statusFilter.addEventListener('input', debounce(executeFilteringPipeline, 200));
        DOM.hideEmptyColsCheckbox.addEventListener('change', executeFilteringPipeline);

        // Primary Action Controls
        DOM.exportJsonBtn.addEventListener('click', exportCleanedJsonFile);
        DOM.copyClipboardBtn.addEventListener('click', copyJsonToClipboard);

        // Grid Pagination Movement
        DOM.prevPageBtn.addEventListener('click', () => changeGridPage(-1));
        DOM.nextPageBtn.addEventListener('click', () => changeGridPage(1));
    }

    // --- Theme Mechanics ---
    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        if (currentTheme === 'dark') {
            document.documentElement.removeAttribute('data-theme');
        } else {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
    }

    // --- Drag and Drop Logic ---
    function onDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        DOM.dropZone.classList.add('drag-over');
    }

    function onDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        DOM.dropZone.classList.remove('drag-over');
    }

    function onDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        DOM.dropZone.classList.remove('drag-over');
        
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            processSelectedFile(e.dataTransfer.files[0]);
        }
    }

    function onFileSelected(e) {
        if (e.target.files && e.target.files.length > 0) {
            processSelectedFile(e.target.files[0]);
        }
    }

    // --- Core File Validation & Ingest ---
    function processSelectedFile(file) {
        if (!file) return;

        // Validation against sizing thresholds
        if (file.size > appState.maxFileSize) {
            alert(`File size exceeds compliance rule. Max size is 5MB. Current file is ${(file.size / (1024 * 1024)).toFixed(2)}MB.`);
            DOM.fileInput.value = '';
            return;
        }

        DOM.fileName.textContent = file.name;
        DOM.fileSize.textContent = `(${formatByteSize(file.size)})`;
        DOM.fileInfo.classList.remove('hidden');

        const reader = new FileReader();
        reader.onload = function (e) {
            const fileContents = e.target.result;
            parseCsvDataEngine(fileContents);
            DOM.workspace.classList.remove('hidden');
            executeFilteringPipeline();
        };
        reader.readAsText(file);
    }

    // --- RFC 4180 Compliant High-Performance CSV Parser ---
    function parseCsvDataEngine(text) {
        const lines = [];
        let row = [""];
        let insideQuote = false;

        if (!text || text.length === 0) {
            appState.rawHeaders = [];
            appState.rawRows = [];
            return;
        }

        for (let i = 0; i < text.length; i++) {
            const currentCc = text[i];
            const nextCc = text[i + 1];

            if (insideQuote) {
                if (currentCc === '"') {
                    if (nextCc === '"') {
                        row[row.length - 1] += '"';
                        i++; 
                    } else {
                        insideQuote = false; 
                    }
                } else {
                    row[row.length - 1] += currentCc;
                }
            } else {
                if (currentCc === '"') {
                    insideQuote = true;
                } else if (currentCc === ',') {
                    row.push('');
                } else if (currentCc === '\r' || currentCc === '\n') {
                    if (row.length > 1 || row[0] !== '') {
                        lines.push(row);
                    }
                    row = [''];
                    if (currentCc === '\r' && nextCc === '\n') {
                        i++; 
                    }
                } else {
                    row[row.length - 1] += currentCc;
                }
            }
        }
        
        if (row.length > 1 || row[0] !== '') {
            lines.push(row);
        }

        if (lines.length > 0) {
            appState.rawHeaders = lines[0].map(h => h.trim() || 'Unnamed_Column');
            
            appState.rawRows = lines.slice(1).map(r => {
                const item = {};
                appState.rawHeaders.forEach((header, index) => {
                    item[header] = r[index] !== undefined ? r[index].trim() : '';
                });
                return item;
            });
        }
    }

    // --- Data Processing Pipeline (Filtering & Column Evaluation) ---
    function executeFilteringPipeline() {
        const filterText = DOM.statusFilter.value.trim().toLowerCase();
        const shouldHideEmpty = DOM.hideEmptyColsCheckbox.checked;

        // Auto-detect variance in column naming configurations (e.g. "Status", "status", "status code")
        const targetStatusKey = appState.rawHeaders.find(h => {
            const lowHead = h.toLowerCase();
            return lowHead === 'status' || lowHead === 'status code' || lowHead === 'status_code';
        }) || null;

        if (filterText && targetStatusKey) {
            const targets = filterText.split(',').map(t => t.trim()).filter(t => t.length > 0);
            
            appState.filteredRows = appState.rawRows.filter(row => {
                const val = (row[targetStatusKey] || '').toLowerCase();
                return targets.some(target => val.includes(target));
            });
        } else {
            appState.filteredRows = [...appState.rawRows];
        }

        let visibleHeaders = [...appState.rawHeaders];
        if (shouldHideEmpty && appState.filteredRows.length > 0) {
            visibleHeaders = appState.rawHeaders.filter(header => {
                return appState.filteredRows.some(row => row[header] !== undefined && row[header] !== '');
            });
        }

        appState.activeHeaders = visibleHeaders;
        appState.currentPage = 1;

        updateGridPaginationMetrics();
        renderPreviewGrid();
    }

    // --- Pagination Calculation Mechanics ---
    function updateGridPaginationMetrics() {
        const totalRows = appState.filteredRows.length;
        const totalPages = Math.ceil(totalRows / appState.rowsPerPage) || 1;
        
        appState.currentPage = Math.min(appState.currentPage, totalPages);
        
        DOM.totalCount.textContent = appState.rawRows.length;
        DOM.visibleCount.textContent = totalRows;
        DOM.currentPageNum.textContent = appState.currentPage;
        DOM.totalPageNum.textContent = totalPages;

        DOM.prevPageBtn.disabled = appState.currentPage === 1;
        DOM.nextPageBtn.disabled = appState.currentPage === totalPages;

        const startIdx = (appState.currentPage - 1) * appState.rowsPerPage;
        const endIdx = startIdx + appState.rowsPerPage;
        appState.paginatedRows = appState.filteredRows.slice(startIdx, endIdx);
    }

    function changeGridPage(direction) {
        appState.currentPage += direction;
        updateGridPaginationMetrics();
        renderPreviewGrid();
    }

    // --- Safe Dynamic Grid Renderer ---
    function renderPreviewGrid() {
        DOM.tableHeader.innerHTML = '';
        DOM.tableBody.innerHTML = '';

        if (appState.paginatedRows.length === 0) {
            DOM.noDataMessage.classList.remove('hidden');
            return;
        }
        DOM.noDataMessage.classList.add('hidden');

        const trHeader = document.createElement('tr');
        appState.activeHeaders.forEach(headerText => {
            const th = document.createElement('th');
            th.textContent = headerText;
            trHeader.appendChild(th);
        });
        DOM.tableHeader.appendChild(trHeader);

        appState.paginatedRows.forEach(rowData => {
            const trRow = document.createElement('tr');
            appState.activeHeaders.forEach(headerKey => {
                const td = document.createElement('td');
                const cellVal = rowData[headerKey] || '';
                td.textContent = cellVal;
                td.setAttribute('title', cellVal); 
                trRow.appendChild(td);
            });
            DOM.tableBody.appendChild(trRow);
        });
    }

    function generateCleanedJsonString() {
        const cleanCollection = appState.filteredRows.map(row => {
            const strippedRow = {};
            appState.activeHeaders.forEach(h => {
                strippedRow[h] = row[h];
            });
            return strippedRow;
        });

        return JSON.stringify(cleanCollection, null, 2);
    }

    function exportCleanedJsonFile() {
        if (appState.filteredRows.length === 0) {
            alert("No data available to export.");
            return;
        }

        const jsonString = generateCleanedJsonString();
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const downloaderElement = document.createElement('a');
        downloaderElement.href = url;
        downloaderElement.download = 'result.json';
        
        document.body.appendChild(downloaderElement);
        downloaderElement.click();
        
        document.body.removeChild(downloaderElement);
        URL.revokeObjectURL(url);
    }

    function copyJsonToClipboard() {
        if (appState.filteredRows.length === 0) {
            alert("No data available to copy.");
            return;
        }

        const jsonString = generateCleanedJsonString();
        navigator.clipboard.writeText(jsonString).then(() => {
            const originalText = DOM.copyClipboardBtn.innerHTML;
            DOM.copyClipboardBtn.textContent = "✓ Copied!";
            setTimeout(() => {
                DOM.copyClipboardBtn.innerHTML = originalText;
            }, 2000);
        }).catch(err => {
            console.error('Could not copy system stream logs: ', err);
        });
    }

    function resetApplicationState() {
        appState.rawHeaders = [];
        appState.rawRows = [];
        appState.filteredRows = [];
        appState.paginatedRows = [];
        appState.currentPage = 1;

        DOM.fileInput.value = '';
        DOM.statusFilter.value = '';
        DOM.hideEmptyColsCheckbox.checked = false;
        
        DOM.fileInfo.classList.add('hidden');
        DOM.workspace.classList.add('hidden');
        DOM.tableHeader.innerHTML = '';
        DOM.tableBody.innerHTML = '';
    }

    function debounce(func, timeout = 300) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => { func.apply(this, args); }, timeout);
        };
    }

    function formatByteSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    initializeListeners();
})();