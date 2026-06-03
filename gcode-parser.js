/**
 * G-code Parser for CNC/Laser toolpaths.
 * Converts raw G-code text into structured geometry segments.
 */

class GCodeParser {
    constructor() {
        this.reset();
    }

    reset() {
        this.state = {
            x: 0,
            y: 0,
            z: 0,
            f: 0,
            t: 0,
            motionMode: 'G0', // G0, G1, G2, G3
            absolutePositioning: true, // G90 = true, G91 = false
            inches: false, // G20 = true, G21 = false
            arcRelative: true // I, J relative to start point (standard)
        };
        this.paths = [];
        this.currentPath = null;
        this.bounds = {
            minX: Infinity, maxX: -Infinity,
            minY: Infinity, maxY: -Infinity,
            minZ: Infinity, maxZ: -Infinity
        };
        this.stats = {
            totalLines: 0,
            rapidLength: 0,
            cutLength: 0,
            zChanges: 0,
            tools: new Set()
        };
    }

    updateBounds(x, y, z) {
        if (x < this.bounds.minX) this.bounds.minX = x;
        if (x > this.bounds.maxX) this.bounds.maxX = x;
        if (y < this.bounds.minY) this.bounds.minY = y;
        if (y > this.bounds.maxY) this.bounds.maxY = y;
        if (z < this.bounds.minZ) this.bounds.minZ = z;
        if (z > this.bounds.maxZ) this.bounds.maxZ = z;
    }

    startNewPath(type, z, tool) {
        if (this.currentPath && this.currentPath.points.length > 1) {
            this.paths.push(this.currentPath);
        }
        this.currentPath = {
            type: type, // 'rapid' or 'cut'
            z: z,
            tool: tool,
            segments: [],
            points: [{ x: this.state.x, y: this.state.y, z: this.state.z }]
        };
    }

    addSegment(segment) {
        if (!this.currentPath) {
            this.startNewPath(segment.type, this.state.z, this.state.t);
        } else if (this.currentPath.type !== segment.type || Math.abs(this.currentPath.z - segment.end.z) > 0.001 || this.currentPath.tool !== segment.tool) {
            // Start a new path if motion type (rapid vs cut), Z depth, or Tool changes
            this.startNewPath(segment.type, segment.end.z, segment.tool);
        }

        this.currentPath.segments.push(segment);
        this.currentPath.points.push(segment.end);
        
        // Track statistics
        const len = segment.length;
        if (segment.type === 'rapid') {
            this.stats.rapidLength += len;
        } else {
            this.stats.cutLength += len;
        }
    }

    parse(gcodeText) {
        this.reset();
        
        const lines = gcodeText.split(/\r?\n/);
        this.stats.totalLines = lines.length;

        // Ensure we start with an initial path
        this.startNewPath('rapid', this.state.z, this.state.t);
        this.updateBounds(this.state.x, this.state.y, this.state.z);

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const rawLine = lines[lineIndex];
            const cleanLine = this.stripComments(rawLine).trim();
            if (!cleanLine) continue;

            const tokens = this.tokenize(cleanLine);
            if (tokens.length === 0) continue;

            this.processLine(tokens, lineIndex);
        }

        // Push the final path if it has points
        if (this.currentPath && this.currentPath.points.length > 1) {
            this.paths.push(this.currentPath);
        }

        // If bounds are infinity, reset to zero
        if (this.bounds.minX === Infinity) {
            this.bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
        }

        return {
            paths: this.paths,
            bounds: this.bounds,
            stats: {
                totalLines: this.stats.totalLines,
                rapidLength: Number(this.stats.rapidLength.toFixed(2)),
                cutLength: Number(this.stats.cutLength.toFixed(2)),
                zChanges: this.stats.zChanges,
                tools: Array.from(this.stats.tools),
                originalUnit: this.state.inches ? 'in' : 'mm'
            }
        };
    }

    stripComments(line) {
        // Strip comments in parentheses: (comment)
        let clean = line.replace(/\([^)]*\)/g, '');
        // Strip comments after semicolon: ; comment
        const semiColonIndex = clean.indexOf(';');
        if (semiColonIndex !== -1) {
            clean = clean.substring(0, semiColonIndex);
        }
        return clean;
    }

    tokenize(line) {
        // Find letters followed by numbers (including signs and decimals)
        const regex = /([A-Z])\s*(-?\d*\.?\d+)/gi;
        const tokens = [];
        let match;
        while ((match = regex.exec(line)) !== null) {
            tokens.push({
                key: match[1].toUpperCase(),
                value: parseFloat(match[2])
            });
        }
        return tokens;
    }

    processLine(tokens, lineIndex) {
        // Look for state-changing G-codes first
        let isMotion = false;
        let newMotionMode = null;
        let commandCode = null;

        for (const token of tokens) {
            if (token.key === 'G') {
                commandCode = Math.round(token.value * 10) / 10; // Handle codes like G0, G01, G17 etc.
                
                if (commandCode === 0 || commandCode === 1 || commandCode === 2 || commandCode === 3) {
                    newMotionMode = 'G' + Math.round(commandCode);
                    isMotion = true;
                } else if (commandCode === 20) {
                    this.state.inches = true;
                } else if (commandCode === 21) {
                    this.state.inches = false;
                } else if (commandCode === 90) {
                    this.state.absolutePositioning = true;
                } else if (commandCode === 91) {
                    this.state.absolutePositioning = false;
                }
            } else if (token.key === 'M') {
                const mCode = Math.round(token.value);
                if (mCode === 6) {
                    // Tool change. In next loop or token we will find T
                }
            }
        }

        // Parse coordinates from line
        let xVal = null, yVal = null, zVal = null;
        let iVal = null, jVal = null, rVal = null;
        let fVal = null, tVal = null;

        for (const token of tokens) {
            switch (token.key) {
                case 'X': xVal = token.value; isMotion = true; break;
                case 'Y': yVal = token.value; isMotion = true; break;
                case 'Z': zVal = token.value; isMotion = true; break;
                case 'I': iVal = token.value; break;
                case 'J': jVal = token.value; break;
                case 'R': rVal = token.value; break;
                case 'F': fVal = token.value; break;
                case 'T': tVal = Math.round(token.value); break;
            }
        }

        // Apply scale factor (convert to mm if inches)
        const scale = this.state.inches ? 25.4 : 1.0;

        if (tVal !== null) {
            this.state.t = tVal;
            this.stats.tools.add(tVal);
        }

        if (fVal !== null) {
            this.state.f = fVal;
        }

        // Update motion mode if specified
        if (newMotionMode !== null) {
            this.state.motionMode = newMotionMode;
        }

        // If it's a motion line and we have coordinate changes
        if (isMotion) {
            const startPoint = { x: this.state.x, y: this.state.y, z: this.state.z };
            
            // Calculate targets
            let targetX = this.state.x;
            let targetY = this.state.y;
            let targetZ = this.state.z;

            if (xVal !== null) {
                targetX = this.state.absolutePositioning ? (xVal * scale) : (this.state.x + xVal * scale);
            }
            if (yVal !== null) {
                targetY = this.state.absolutePositioning ? (yVal * scale) : (this.state.y + yVal * scale);
            }
            if (zVal !== null) {
                const oldZ = this.state.z;
                targetZ = this.state.absolutePositioning ? (zVal * scale) : (this.state.z + zVal * scale);
                if (Math.abs(oldZ - targetZ) > 0.001) {
                    this.stats.zChanges++;
                }
            }

            const endPoint = { x: targetX, y: targetY, z: targetZ };
            const type = (this.state.motionMode === 'G0') ? 'rapid' : 'cut';

            // Process movement based on motion mode
            if (this.state.motionMode === 'G0' || this.state.motionMode === 'G1') {
                const len = Math.sqrt(
                    Math.pow(endPoint.x - startPoint.x, 2) + 
                    Math.pow(endPoint.y - startPoint.y, 2) + 
                    Math.pow(endPoint.z - startPoint.z, 2)
                );

                if (len > 0.0001) {
                    this.addSegment({
                        type: type,
                        command: this.state.motionMode,
                        start: startPoint,
                        end: endPoint,
                        length: len,
                        feed: this.state.f,
                        tool: this.state.t,
                        line: lineIndex
                    });
                }
            } else if (this.state.motionMode === 'G2' || this.state.motionMode === 'G3') {
                // Arc moves (CW or CCW) in the XY plane
                const isCW = (this.state.motionMode === 'G2');
                let cx, cy;
                let radius;

                if (rVal !== null) {
                    // Radius arc
                    radius = Math.abs(rVal * scale);
                    const dx = endPoint.x - startPoint.x;
                    const dy = endPoint.y - startPoint.y;
                    const d = Math.sqrt(dx * dx + dy * dy);

                    if (d < 0.0001) {
                        // Start and end are same, cannot determine center with radius R
                        cx = startPoint.x;
                        cy = startPoint.y;
                        radius = 0;
                    } else if (d > 2 * radius) {
                        // Radius too small for distance, clamp radius to half distance
                        radius = d / 2;
                        cx = startPoint.x + dx / 2;
                        cy = startPoint.y + dy / 2;
                    } else {
                        // Solve for center
                        const mx = startPoint.x + dx / 2;
                        const my = startPoint.y + dy / 2;
                        const h = Math.sqrt(radius * radius - (d * d) / 4);
                        
                        // Perpendicular vector
                        const vx = -dy / d;
                        const vy = dx / d;
                        
                        // sign of R determines minor/major arc
                        const sign = rVal >= 0 ? 1 : -1;
                        
                        if (isCW) {
                            cx = mx - sign * h * vx;
                            cy = my - sign * h * vy;
                        } else {
                            cx = mx + sign * h * vx;
                            cy = my + sign * h * vy;
                        }
                    }
                } else {
                    // Offset center arc using I and J
                    const offsetI = (iVal || 0) * scale;
                    const offsetJ = (jVal || 0) * scale;

                    if (this.state.arcRelative) {
                        cx = startPoint.x + offsetI;
                        cy = startPoint.y + offsetJ;
                    } else {
                        cx = offsetI;
                        cy = offsetJ;
                    }
                    
                    const dx = startPoint.x - cx;
                    const dy = startPoint.y - cy;
                    radius = Math.sqrt(dx * dx + dy * dy);
                }

                // Compute length of arc
                const dx1 = startPoint.x - cx;
                const dy1 = startPoint.y - cy;
                const dx2 = endPoint.x - cx;
                const dy2 = endPoint.y - cy;

                let theta1 = Math.atan2(dy1, dx1);
                let theta2 = Math.atan2(dy2, dx2);

                if (theta1 < 0) theta1 += 2 * Math.PI;
                if (theta2 < 0) theta2 += 2 * Math.PI;

                let sweep;
                if (isCW) {
                    sweep = theta1 - theta2;
                    if (sweep <= 0) sweep += 2 * Math.PI;
                } else {
                    sweep = theta2 - theta1;
                    if (sweep <= 0) sweep += 2 * Math.PI;
                }

                const arcLength = radius * sweep;
                const zLen = Math.abs(endPoint.z - startPoint.z);
                const len = Math.sqrt(arcLength * arcLength + zLen * zLen);

                if (len > 0.0001) {
                    this.addSegment({
                        type: type,
                        command: this.state.motionMode,
                        start: startPoint,
                        end: endPoint,
                        center: { x: cx, y: cy },
                        radius: radius,
                        startAngle: theta1,
                        endAngle: theta2,
                        sweep: sweep,
                        isCW: isCW,
                        length: len,
                        feed: this.state.f,
                        tool: this.state.t,
                        line: lineIndex
                    });
                }
            }

            // Update state coordinates
            this.state.x = targetX;
            this.state.y = targetY;
            this.state.z = targetZ;

            this.updateBounds(this.state.x, this.state.y, this.state.z);
        }
    }
}

// Export class
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GCodeParser;
} else {
    window.GCodeParser = GCodeParser;
}
