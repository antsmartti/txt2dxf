/**
 * Main application coordinator for the G-code to DXF tool.
 * Handles UI interactions, files, states, and export actions.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Instantiate components
    const parser = new GCodeParser();
    const preview = new CanvasPreview('viewportCanvas');

    // UI state
    let loadedFiles = []; // Array of { name, content, size }
    let currentParsedData = null;
    let exportFilename = 'converted_toolpath.dxf';

    // Settings state
    const getSettings = () => {
        const millDiameter = parseFloat(document.getElementById('millDiameter').value) || 0;
        const exportUnits = document.getElementById('exportUnits').value;
        const layerGrouping = document.getElementById('layerGrouping').value;
        const tolerance = parseFloat(document.getElementById('curveTolerance').value) || 0.2;
        const includeRapids = document.getElementById('includeRapids').checked;
        
        // Find active offset button
        const activeOffsetBtn = document.querySelector('#offsetDirectionSelector button.active');
        const offsetDirection = activeOffsetBtn ? activeOffsetBtn.getAttribute('data-dir') : 'none';

        return {
            toolDiameter: millDiameter,
            offsetDirection: offsetDirection,
            tolerance: tolerance,
            layerGrouping: layerGrouping,
            exportUnits: exportUnits,
            includeRapids: includeRapids
        };
    };

    // DOM references
    const dropzone = document.getElementById('fileDropzone');
    const fileInput = document.getElementById('fileInput');
    const filesList = document.getElementById('filesList');
    const btnExportDXF = document.getElementById('btnExportDXF');
    const emptyState = document.getElementById('emptyState');
    const statsOverlay = document.getElementById('statsOverlay');
    const gcodeEditor = document.getElementById('gcodeEditor');
    
    // Settings inputs
    const inputMillDiameter = document.getElementById('millDiameter');
    const selectExportUnits = document.getElementById('exportUnits');
    const sliderCurveTolerance = document.getElementById('curveTolerance');
    const textCurveToleranceVal = document.getElementById('curveToleranceVal');
    const selectLayerGrouping = document.getElementById('layerGrouping');
    const checkboxIncludeRapids = document.getElementById('includeRapids');
    const btnOffsetNone = document.getElementById('btnOffsetNone');
    const btnOffsetLeft = document.getElementById('btnOffsetLeft');
    const btnOffsetRight = document.getElementById('btnOffsetRight');

    // Toolbar buttons
    const btnToggleGrid = document.getElementById('btnToggleGrid');
    const btnToggleOriginal = document.getElementById('btnToggleOriginal');
    const btnToggleOffset = document.getElementById('btnToggleOffset');
    const btnZoomToFit = document.getElementById('btnZoomToFit');
    const btnCollapseEditor = document.getElementById('btnCollapseEditor');
    const gcodeSidebar = document.getElementById('gcodeSidebar');

    // Stats elements
    const statTotalLines = document.getElementById('statTotalLines');
    const statUnit = document.getElementById('statUnit');
    const statCutLength = document.getElementById('statCutLength');
    const statRapidLength = document.getElementById('statRapidLength');
    const statBoundsX = document.getElementById('statBoundsX');
    const statBoundsY = document.getElementById('statBoundsY');
    const statBoundsZ = document.getElementById('statBoundsZ');
    const statZChanges = document.getElementById('statZChanges');
    
    // Editor stats
    const editorStatsLines = document.getElementById('editorStatsLines');
    const editorStatsModified = document.getElementById('editorStatsModified');

    // Initialize UI settings inside components
    const updatePreviewSettings = () => {
        const settings = getSettings();
        preview.setSettings(settings);
    };

    // Bind settings changes to visualizer updates
    inputMillDiameter.addEventListener('input', () => {
        updatePreviewSettings();
    });

    selectExportUnits.addEventListener('change', (e) => {
        const unit = e.target.value;
        // Update diameter unit label
        document.getElementById('millDiameterUnit').textContent = unit;
        
        // Update stats numbers if data is loaded
        if (currentParsedData) {
            updateStatsUI(currentParsedData);
        }
        updatePreviewSettings();
    });

    // Handle segmented control clicks
    [btnOffsetNone, btnOffsetLeft, btnOffsetRight].forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('#offsetDirectionSelector button').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            updatePreviewSettings();
        });
    });

    sliderCurveTolerance.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value).toFixed(2);
        textCurveToleranceVal.textContent = `${val} mm`;
        updatePreviewSettings();
    });

    selectLayerGrouping.addEventListener('change', () => {
        // Doesn't affect visualizer directly, but good to keep updated
        updatePreviewSettings();
    });

    checkboxIncludeRapids.addEventListener('change', () => {
        updatePreviewSettings();
    });

    // Bind toolbar toggles
    btnToggleGrid.addEventListener('click', () => {
        preview.showGrid = !preview.showGrid;
        btnToggleGrid.classList.toggle('active', preview.showGrid);
        preview.draw();
    });

    btnToggleOriginal.addEventListener('click', () => {
        preview.showOriginal = !preview.showOriginal;
        btnToggleOriginal.classList.toggle('active', preview.showOriginal);
        preview.draw();
    });

    btnToggleOffset.addEventListener('click', () => {
        preview.showOffset = !preview.showOffset;
        btnToggleOffset.classList.toggle('active', preview.showOffset);
        preview.draw();
    });

    btnZoomToFit.addEventListener('click', () => {
        preview.zoomToFit();
    });

    btnCollapseEditor.addEventListener('click', () => {
        gcodeSidebar.classList.toggle('collapsed');
        
        const isCollapsed = gcodeSidebar.classList.contains('collapsed');
        btnCollapseEditor.style.transform = isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)';
        
        // Resize canvas after layout shift
        setTimeout(() => {
            preview.resize();
        }, 300);
    });

    // File Drag and Drop events
    dropzone.addEventListener('click', () => fileInput.click());
    
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleSelectedFiles(e.dataTransfer.files);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleSelectedFiles(e.target.files);
        }
    });

    // Process loaded files
    const handleSelectedFiles = async (files) => {
        const filePromises = Array.from(files).map(file => {
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    resolve({
                        name: file.name,
                        size: file.size,
                        content: e.target.result
                    });
                };
                reader.readAsText(file);
            });
        });

        const newFiles = await Promise.all(filePromises);
        loadedFiles = [...loadedFiles, ...newFiles];
        
        // Update filename for export based on the first loaded file
        if (newFiles.length > 0) {
            const firstName = newFiles[0].name;
            const extIndex = firstName.lastIndexOf('.');
            const baseName = extIndex !== -1 ? firstName.substring(0, extIndex) : firstName;
            exportFilename = `${baseName}_converted.dxf`;
        }

        rebuildGCodeFromFiles();
    };

    // Concatenate loaded files and run parser
    const rebuildGCodeFromFiles = () => {
        updateFilesListUI();

        if (loadedFiles.length === 0) {
            // Reset to empty state
            currentParsedData = null;
            emptyState.style.display = 'flex';
            statsOverlay.classList.remove('active');
            btnExportDXF.disabled = true;
            gcodeEditor.value = '';
            editorStatsLines.textContent = 'Lines: 0';
            editorStatsModified.textContent = 'Ready';
            preview.setData(null);
            return;
        }

        // Merge contents
        let mergedGCode = '';
        for (const file of loadedFiles) {
            mergedGCode += `(--- START FILE: ${file.name} ---)\n`;
            mergedGCode += file.content;
            mergedGCode += `\n(--- END FILE: ${file.name} ---)\n\n`;
        }

        // Set text area
        gcodeEditor.value = mergedGCode;
        editorStatsLines.textContent = `Lines: ${mergedGCode.split('\n').length}`;
        editorStatsModified.textContent = 'Synced';

        // Parse and visualize
        processGCode(mergedGCode);
    };

    const processGCode = (text) => {
        try {
            const parsed = parser.parse(text);
            currentParsedData = parsed;
            
            // Update UI elements
            emptyState.style.display = 'none';
            statsOverlay.classList.add('active');
            btnExportDXF.disabled = false;
            
            updateStatsUI(parsed);
            
            // Send paths to visualizer and update settings
            preview.setData(parsed);
            updatePreviewSettings();
        } catch (err) {
            console.error('Parsing error: ', err);
            alert('An error occurred while parsing the G-code file. See console for details.');
        }
    };

    // Update the visual files list panel
    const updateFilesListUI = () => {
        filesList.innerHTML = '';
        
        loadedFiles.forEach((file, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'file-item-name';
            nameSpan.textContent = file.name;
            nameSpan.title = file.name;
            
            const infoDiv = document.createElement('div');
            infoDiv.style.display = 'flex';
            infoDiv.style.alignItems = 'center';
            infoDiv.style.gap = '0.5rem';

            const sizeSpan = document.createElement('span');
            sizeSpan.className = 'file-item-size';
            const kbSize = (file.size / 1024).toFixed(1);
            sizeSpan.textContent = `${kbSize} KB`;

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'file-item-remove';
            removeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
            removeBtn.addEventListener('click', () => {
                loadedFiles.splice(index, 1);
                rebuildGCodeFromFiles();
            });

            infoDiv.appendChild(sizeSpan);
            infoDiv.appendChild(removeBtn);
            
            fileItem.appendChild(nameSpan);
            fileItem.appendChild(infoDiv);
            
            filesList.appendChild(fileItem);
        });
    };

    // Update stats details panel overlay
    const updateStatsUI = (parsed) => {
        const { stats, bounds } = parsed;
        const displayUnits = selectExportUnits.value;
        
        // Scale values depending on selected export unit vs original unit
        const scale = displayUnits === 'in' ? (1 / 25.4) : 1.0;

        statTotalLines.textContent = stats.totalLines.toLocaleString();
        statUnit.textContent = displayUnits.toUpperCase();
        
        statCutLength.textContent = `${(stats.cutLength * scale).toFixed(2)} ${displayUnits}`;
        statRapidLength.textContent = `${(stats.rapidLength * scale).toFixed(2)} ${displayUnits}`;
        
        const wX = Math.max(0, bounds.maxX - bounds.minX) * scale;
        const wY = Math.max(0, bounds.maxY - bounds.minY) * scale;
        const wZ = Math.max(0, bounds.maxZ - bounds.minZ) * scale;

        statBoundsX.textContent = `${wX.toFixed(2)} ${displayUnits} [${(bounds.minX * scale).toFixed(1)} to ${(bounds.maxX * scale).toFixed(1)}]`;
        statBoundsY.textContent = `${wY.toFixed(2)} ${displayUnits} [${(bounds.minY * scale).toFixed(1)} to ${(bounds.maxY * scale).toFixed(1)}]`;
        statBoundsZ.textContent = `${wZ.toFixed(2)} ${displayUnits} [${(bounds.minZ * scale).toFixed(1)} to ${(bounds.maxZ * scale).toFixed(1)}]`;
        
        statZChanges.textContent = stats.zChanges.toString();
    };

    // Debounced text editor input sync
    let editorDebounceTimer = null;
    gcodeEditor.addEventListener('input', () => {
        editorStatsModified.textContent = 'Typing...';
        clearTimeout(editorDebounceTimer);
        
        editorDebounceTimer = setTimeout(() => {
            const content = gcodeEditor.value;
            editorStatsLines.textContent = `Lines: ${content.split('\n').length}`;
            
            // Re-parse directly from editor content
            try {
                const parsed = parser.parse(content);
                currentParsedData = parsed;
                updateStatsUI(parsed);
                preview.setData(parsed);
                updatePreviewSettings();
                editorStatsModified.textContent = 'Synced';
                
                // Set export filename to generic since it has been modified manually
                if (loadedFiles.length > 0 && exportFilename.indexOf('_modified') === -1) {
                    const extIndex = exportFilename.lastIndexOf('.');
                    exportFilename = `${exportFilename.substring(0, extIndex)}_modified.dxf`;
                }
            } catch (err) {
                editorStatsModified.textContent = 'Parse Error';
                console.error(err);
            }
        }, 500);
    });

    // Export and trigger download of the DXF file
    btnExportDXF.addEventListener('click', () => {
        if (!currentParsedData) return;

        const settings = getSettings();
        
        try {
            const dxfContent = window.DXFGenerator.generate(currentParsedData, settings);
            
            // Generate download Blob
            const blob = new Blob([dxfContent], { type: 'application/dxf;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            
            const link = document.createElement('a');
            link.href = url;
            link.download = exportFilename;
            
            document.body.appendChild(link);
            link.click();
            
            // Clean up
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('DXF Generation Failed:', err);
            alert('Failed to generate DXF. Please verify your settings and tool diameter values.');
        }
    });

    // Drag-over styling overrides
    window.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    
    window.addEventListener('drop', (e) => {
        e.preventDefault();
    });
});
