/**
 * Canvas G-Code & DXF Visualizer.
 * Provides pan, zoom, grid, axes, mill cursor, and path renders.
 */

class CanvasPreview {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        
        this.scale = 1.0;
        this.xOffset = 0;
        this.yOffset = 0;
        
        this.parsedData = null;
        this.settings = {
            toolDiameter: 0,
            offsetDirection: 'none',
            tolerance: 0.2,
            includeRapids: false
        };

        this.mousePos = { x: 0, y: 0 };
        this.isPanning = false;
        this.panStart = { x: 0, y: 0 };
        
        this.showGrid = true;
        this.showOriginal = true;
        this.showOffset = true;

        this.initEvents();
        this.resize();
    }

    initEvents() {
        // Handle window resize
        window.addEventListener('resize', () => this.resize());

        // Mouse pan & zoom
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // Left click
                this.isPanning = true;
                this.panStart.x = e.clientX - this.xOffset;
                this.panStart.y = e.clientY - this.yOffset;
                this.canvas.style.cursor = 'grabbing';
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.isPanning) {
                this.isPanning = false;
                this.canvas.style.cursor = 'grab';
            }
        });

        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            this.mousePos.x = e.clientX - rect.left;
            this.mousePos.y = e.clientY - rect.top;

            if (this.isPanning) {
                this.xOffset = e.clientX - this.panStart.x;
                this.yOffset = e.clientY - this.panStart.y;
                this.draw();
            } else {
                // Redraw to update mill cursor position
                this.draw();
            }
        });

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            // Get mouse position in world coordinates before zoom
            const rect = this.canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const worldPt = this.canvasToWorld(mx, my);

            // Calculate new scale
            const zoomFactor = e.deltaY < 0 ? 1.15 : 1.0 / 1.15;
            const newScale = Math.max(0.01, Math.min(1000, this.scale * zoomFactor));

            // Adjust offsets so the world coordinate remains under mouse
            this.scale = newScale;
            this.xOffset = mx - worldPt.x * this.scale;
            this.yOffset = my + worldPt.y * this.scale;

            this.draw();
        }, { passive: false });
    }

    resize() {
        const parent = this.canvas.parentElement;
        this.canvas.width = parent.clientWidth;
        this.canvas.height = parent.clientHeight;
        this.draw();
    }

    setData(parsedData) {
        this.parsedData = parsedData;
        this.zoomToFit();
    }

    setSettings(settings) {
        this.settings = { ...this.settings, ...settings };
        this.draw();
    }

    worldToCanvas(x, y) {
        return {
            x: this.xOffset + x * this.scale,
            y: this.yOffset - y * this.scale
        };
    }

    canvasToWorld(cx, cy) {
        return {
            x: (cx - this.xOffset) / this.scale,
            y: (this.yOffset - cy) / this.scale
        };
    }

    zoomToFit() {
        if (!this.parsedData || !this.parsedData.bounds) return;

        const bounds = this.parsedData.bounds;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const padding = 40; // Pixels

        const boundsW = bounds.maxX - bounds.minX;
        const boundsH = bounds.maxY - bounds.minY;

        if (boundsW <= 0 || boundsH <= 0 || isNaN(boundsW) || isNaN(boundsH)) {
            // Default reset
            this.scale = 1.0;
            this.xOffset = width / 2;
            this.yOffset = height / 2;
            this.draw();
            return;
        }

        const scaleX = (width - padding * 2) / boundsW;
        const scaleY = (height - padding * 2) / boundsH;
        this.scale = Math.min(scaleX, scaleY);

        // Center coordinates
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;

        this.xOffset = width / 2 - centerX * this.scale;
        this.yOffset = height / 2 + centerY * this.scale;

        this.draw();
    }

    draw() {
        // Clear canvas
        this.ctx.fillStyle = '#04060a';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw grid
        if (this.showGrid) {
            this.drawGrid();
        }

        // Draw axes
        this.drawAxes();

        // Draw paths
        if (this.parsedData) {
            this.drawPaths();
        }

        // Draw mill diameter overlay at mouse cursor
        if (this.parsedData && this.settings.toolDiameter > 0) {
            this.drawMillCursor();
        }
    }

    drawGrid() {
        const width = this.canvas.width;
        const height = this.canvas.height;

        const minW = this.canvasToWorld(0, height);
        const maxW = this.canvasToWorld(width, 0);

        // Calculate dynamic grid spacing in world units (mm or inches)
        const targetSpacingPixels = 60;
        const idealSpacing = targetSpacingPixels / this.scale;
        const log = Math.log10(idealSpacing);
        const powerOf10 = Math.pow(10, Math.floor(log));
        const ratio = idealSpacing / powerOf10;

        let spacing = powerOf10;
        if (ratio >= 5) {
            spacing = powerOf10 * 5;
        } else if (ratio >= 2) {
            spacing = powerOf10 * 2;
        }

        // Set line styling
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        this.ctx.lineWidth = 1;
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        this.ctx.font = '9px monospace';

        const startX = Math.floor(minW.x / spacing) * spacing;
        const endX = Math.ceil(maxW.x / spacing) * spacing;
        const startY = Math.floor(minW.y / spacing) * spacing;
        const endY = Math.ceil(maxW.y / spacing) * spacing;

        // Draw Vertical Grid Lines
        for (let x = startX; x <= endX; x += spacing) {
            const canvasPt = this.worldToCanvas(x, 0);
            
            // Highlight every 5th spacing line as major grid
            const isMajor = Math.round(x / spacing) % 5 === 0;
            this.ctx.strokeStyle = isMajor ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.025)';
            
            this.ctx.beginPath();
            this.ctx.moveTo(canvasPt.x, 0);
            this.ctx.lineTo(canvasPt.x, height);
            this.ctx.stroke();

            // Label major grid lines (except near origin)
            if (isMajor && Math.abs(x) > 0.001 && this.scale > 0.2) {
                this.ctx.fillText(x.toFixed(0), canvasPt.x + 3, height - 10);
            }
        }

        // Draw Horizontal Grid Lines
        for (let y = startY; y <= endY; y += spacing) {
            const canvasPt = this.worldToCanvas(0, y);
            
            const isMajor = Math.round(y / spacing) % 5 === 0;
            this.ctx.strokeStyle = isMajor ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.025)';
            
            this.ctx.beginPath();
            this.ctx.moveTo(0, canvasPt.y);
            this.ctx.lineTo(width, canvasPt.y);
            this.ctx.stroke();

            if (isMajor && Math.abs(y) > 0.001 && this.scale > 0.2) {
                this.ctx.fillText(y.toFixed(0), 5, canvasPt.y - 3);
            }
        }
    }

    drawAxes() {
        const origin = this.worldToCanvas(0, 0);
        
        // Draw X-axis
        this.ctx.strokeStyle = 'rgba(6, 182, 212, 0.25)'; // cyan
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.moveTo(0, origin.y);
        this.ctx.lineTo(this.canvas.width, origin.y);
        this.ctx.stroke();

        // Draw Y-axis
        this.ctx.strokeStyle = 'rgba(99, 102, 241, 0.25)'; // indigo
        this.ctx.beginPath();
        this.ctx.moveTo(origin.x, 0);
        this.ctx.lineTo(origin.x, this.canvas.height);
        this.ctx.stroke();

        // Draw Origin Indicator
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        this.ctx.beginPath();
        this.ctx.arc(origin.x, origin.y, 4, 0, 2 * Math.PI);
        this.ctx.fill();

        this.ctx.font = 'bold 9px sans-serif';
        this.ctx.fillStyle = 'rgba(6, 182, 212, 0.6)';
        this.ctx.fillText('X0 Y0', origin.x + 8, origin.y - 8);
    }

    drawPaths() {
        const { paths } = this.parsedData;
        const toolRadius = Math.abs(this.settings.toolDiameter) / 2;

        for (const path of paths) {
            const isCut = path.type === 'cut';
            const isRapid = path.type === 'rapid';

            // Draw original path if requested
            if (this.showOriginal && (isCut || (isRapid && this.settings.includeRapids))) {
                this.ctx.lineWidth = isRapid ? 1.0 : 1.5;
                this.ctx.strokeStyle = isRapid ? 'rgba(239, 68, 68, 0.45)' : 'rgba(255, 255, 255, 0.3)'; // Dotted Red for G0, Grey-white for G1
                this.ctx.setLineDash(isRapid ? [4, 4] : []);
                
                this.ctx.beginPath();
                const start = this.worldToCanvas(path.points[0].x, path.points[0].y);
                this.ctx.moveTo(start.x, start.y);

                for (const seg of path.segments) {
                    if (seg.command === 'G0' || seg.command === 'G1') {
                        const end = this.worldToCanvas(seg.end.x, seg.end.y);
                        this.ctx.lineTo(end.x, end.y);
                    } else if (seg.command === 'G2' || seg.command === 'G3') {
                        this.drawArcSegment(seg);
                    }
                }
                this.ctx.stroke();
            }

            // Draw compensated (offset) path if requested and offset is enabled
            if (this.showOffset && isCut && this.settings.offsetDirection !== 'none' && toolRadius > 0.001) {
                // Generate compensated path points
                const offsetPts = window.DXFGenerator ? 
                    window.DXFGenerator.generateOffsetPath(path, toolRadius, this.settings.offsetDirection, this.settings.tolerance) : [];

                if (offsetPts.length > 1) {
                    this.ctx.lineWidth = 2.0;
                    this.ctx.strokeStyle = '#06b6d4'; // Bright Cyan for compensated path
                    this.ctx.setLineDash([]);
                    
                    this.ctx.beginPath();
                    const start = this.worldToCanvas(offsetPts[0].x, offsetPts[0].y);
                    this.ctx.moveTo(start.x, start.y);

                    for (let i = 1; i < offsetPts.length; i++) {
                        const pt = this.worldToCanvas(offsetPts[i].x, offsetPts[i].y);
                        this.ctx.lineTo(pt.x, pt.y);
                    }

                    this.ctx.stroke();
                }
            }
        }
        
        // Reset dashed line settings
        this.ctx.setLineDash([]);
    }

    drawArcSegment(seg) {
        const { center, radius, startAngle, endAngle, isCW } = seg;
        const cPt = this.worldToCanvas(center.x, center.y);
        const rPix = radius * this.scale;

        if (rPix < 0.1) return;

        // In canvas, Y points down, which means Y-flipped coordinates change the sweep direction!
        // A CCW arc in Cartesian (G3) becomes CW in Canvas coordinates when Y is flipped.
        // A CW arc in Cartesian (G2) becomes CCW in Canvas.
        // We flip angles since canvas vertical axis coordinates are inverted.
        this.ctx.arc(cPt.x, cPt.y, rPix, -startAngle, -endAngle, !isCW);
    }

    drawMillCursor() {
        const toolRadiusPix = (this.settings.toolDiameter / 2) * this.scale;
        if (toolRadiusPix < 1) return;

        // Draw mill diameter circle
        this.ctx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
        this.ctx.fillStyle = 'rgba(6, 182, 212, 0.08)';
        this.ctx.lineWidth = 1.0;
        this.ctx.beginPath();
        this.ctx.arc(this.mousePos.x, this.mousePos.y, toolRadiusPix, 0, 2 * Math.PI);
        this.ctx.fill();
        this.ctx.stroke();

        // Draw center crosshair
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        this.ctx.beginPath();
        this.ctx.moveTo(this.mousePos.x - 5, this.mousePos.y);
        this.ctx.lineTo(this.mousePos.x + 5, this.mousePos.y);
        this.ctx.moveTo(this.mousePos.x, this.mousePos.y - 5);
        this.ctx.lineTo(this.mousePos.x, this.mousePos.y + 5);
        this.ctx.stroke();
    }
}

// Export class
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CanvasPreview;
} else {
    window.CanvasPreview = CanvasPreview;
}
