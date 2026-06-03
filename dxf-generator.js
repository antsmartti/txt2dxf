/**
 * DXF Generator for G-code paths.
 * Produces joined POLYLINE structures in Autodesk DXF (R12) format.
 * Supports tool offset compensation and curve discretization.
 */

class DXFGenerator {
    static generate(parsedData, settings) {
        const { paths, bounds, stats } = parsedData;
        const {
            toolDiameter = 0,
            offsetDirection = 'none', // 'none', 'left', 'right'
            tolerance = 0.2, // mm
            layerGrouping = 'depth', // 'depth', 'tool', 'motion', 'single'
            exportUnits = 'mm', // 'mm' or 'in'
            includeRapids = false
        } = settings;

        const toolRadius = Math.abs(toolDiameter) / 2;
        const unitScale = exportUnits === 'in' ? (1 / 25.4) : 1.0;

        // Step 1: Process paths (apply offsets & discretization)
        const processedPaths = [];
        
        for (const path of paths) {
            if (path.type === 'rapid' && !includeRapids) {
                continue; // Skip rapid paths unless requested
            }

            // We apply offset only to cutting paths (or if offset is not 'none')
            let points = [];
            const isCut = path.type === 'cut';

            if (isCut && offsetDirection !== 'none' && toolRadius > 0.001) {
                // Apply cutter compensation
                points = this.generateOffsetPath(path, toolRadius, offsetDirection, tolerance);
            } else {
                // Standard path: discretize arcs
                points = this.discretizePath(path, tolerance);
            }

            if (points.length > 0) {
                // Apply unit scaling
                if (unitScale !== 1.0) {
                    points = points.map(p => ({
                        x: p.x * unitScale,
                        y: p.y * unitScale,
                        z: p.z * unitScale
                    }));
                }

                // Check if the original path was closed
                const isClosed = this.isPathClosed(path);

                processedPaths.push({
                    type: path.type,
                    z: path.z * unitScale,
                    tool: path.tool,
                    points: points,
                    isClosed: isClosed
                });
            }
        }

        // Step 2: Determine layers
        const layers = new Map(); // name -> color index
        
        for (const path of processedPaths) {
            let layerName = '0';
            let colorIndex = 7; // white/black default

            if (layerGrouping === 'depth') {
                layerName = `CUT_Z_${path.z.toFixed(2)}`;
                // Color code based on Z depth hash or sequence
                colorIndex = Math.abs(Math.round(path.z * 100)) % 6 + 1; // 1 to 6
            } else if (layerGrouping === 'tool') {
                layerName = `TOOL_${path.tool}`;
                colorIndex = (path.tool % 6) + 1; // 1 to 6
            } else if (layerGrouping === 'motion') {
                layerName = path.type === 'rapid' ? 'RAPIDS' : 'CUTS';
                colorIndex = path.type === 'rapid' ? 1 : 3; // 1 = Red, 3 = Green
            } else {
                layerName = 'VECTORS';
                colorIndex = 4; // Cyan
            }

            // Sanitise layer name (dxf allows alphanumeric, underscores, hyphens)
            layerName = layerName.replace(/[^a-zA-Z0-9_-]/g, '_').toUpperCase();

            path.layer = layerName;
            layers.set(layerName, colorIndex);
        }

        // Step 3: Write DXF output
        let dxf = '';
        
        // Header Section
        dxf += '  0\nSECTION\n  2\nHEADER\n';
        dxf += '  9\n$ACADVER\n  1\nAC1009\n'; // AutoCAD R12
        dxf += '  9\n$INSUNITS\n 70\n'; // 1 = Inches, 4 = Millimeters
        dxf += exportUnits === 'in' ? '     1\n' : '     4\n';
        dxf += '  0\nENDSEC\n';

        // Tables Section (Layers)
        dxf += '  0\nSECTION\n  2\nTABLES\n  0\nTABLE\n  2\nLAYER\n 70\n';
        dxf += `    ${layers.size}\n`;
        
        for (const [layerName, color] of layers.entries()) {
            dxf += '  0\nLAYER\n  2\n' + layerName + '\n 70\n    64\n 62\n';
            dxf += `    ${color}\n`;
            dxf += '  6\nCONTINUOUS\n';
        }
        dxf += '  0\nENDTAB\n  0\nENDSEC\n';

        // Blocks Section (Empty)
        dxf += '  0\nSECTION\n  2\nBLOCKS\n  0\nENDSEC\n';

        // Entities Section
        dxf += '  0\nSECTION\n  2\nENTITIES\n';
        
        for (const path of processedPaths) {
            if (path.points.length < 2) continue;

            dxf += '  0\nPOLYLINE\n';
            dxf += '  8\n' + path.layer + '\n';
            dxf += ' 66\n     1\n'; // Vertices follow
            dxf += ' 10\n0.0\n 20\n0.0\n 30\n0.0\n'; // Dummy origin
            dxf += ' 70\n'; // Flags
            dxf += path.isClosed ? '     1\n' : '     0\n';

            for (const pt of path.points) {
                dxf += '  0\nVERTEX\n';
                dxf += '  8\n' + path.layer + '\n';
                dxf += ' 10\n' + pt.x.toFixed(4) + '\n';
                dxf += ' 20\n' + pt.y.toFixed(4) + '\n';
                dxf += ' 30\n' + pt.z.toFixed(4) + '\n';
            }

            dxf += '  0\nSEQEND\n';
            dxf += '  8\n' + path.layer + '\n';
        }

        dxf += '  0\nENDSEC\n  0\nEOF\n';
        return dxf;
    }

    static isPathClosed(path) {
        if (path.points.length < 3) return false;
        const start = path.points[0];
        const end = path.points[path.points.length - 1];
        const d = Math.sqrt(Math.pow(start.x - end.x, 2) + Math.pow(start.y - end.y, 2));
        return d < 0.01; // Consider closed if end point is within 0.01mm of start point
    }

    static discretizePath(path, tolerance) {
        const points = [];
        if (path.segments.length === 0) return points;

        // Push start point of the first segment
        points.push({ ...path.segments[0].start });

        for (const seg of path.segments) {
            if (seg.command === 'G0' || seg.command === 'G1') {
                points.push({ ...seg.end });
            } else if (seg.command === 'G2' || seg.command === 'G3') {
                const arcPoints = this.discretizeArc(seg, tolerance);
                // Skip the first point since it matches seg.start (already pushed)
                for (let i = 1; i < arcPoints.length; i++) {
                    points.push(arcPoints[i]);
                }
            }
        }
        return points;
    }

    static discretizeArc(arc, tolerance) {
        const pts = [];
        const { center, radius, startAngle, sweep, isCW, start, end } = arc;

        if (radius < 0.001) {
            pts.push({ ...start }, { ...end });
            return pts;
        }

        // Chord error: sagitta = R * (1 - cos(theta/2)) <= tolerance
        // theta = 2 * acos(1 - tolerance/R)
        const cosTerm = 1 - (tolerance / radius);
        const maxStep = cosTerm >= 1 ? Math.PI / 18 : 2 * Math.acos(Math.max(-0.99, Math.min(0.99, cosTerm)));
        
        // Ensure at least 4 segments for a full circle, or at least 1 for any sweep
        const numSteps = Math.max(1, Math.ceil(sweep / maxStep));
        
        pts.push({ ...start });
        
        for (let i = 1; i < numSteps; i++) {
            const ratio = i / numSteps;
            const angle = isCW ? (startAngle - sweep * ratio) : (startAngle + sweep * ratio);
            
            // Linear interpolate Z
            const z = start.z + (end.z - start.z) * ratio;

            pts.push({
                x: center.x + radius * Math.cos(angle),
                y: center.y + radius * Math.sin(angle),
                z: z
            });
        }

        pts.push({ ...end });
        return pts;
    }

    static generateOffsetPath(path, offsetDist, direction, tolerance) {
        if (path.segments.length === 0) return [];

        const segments = path.segments;
        const offsetSegments = [];

        // Step 1: Generate offset segments mathematically
        for (const seg of segments) {
            if (seg.command === 'G0' || seg.command === 'G1') {
                // Line segment offset
                const dx = seg.end.x - seg.start.x;
                const dy = seg.end.y - seg.start.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                
                if (len < 0.001) continue;

                // Left normal
                const nx = -dy / len;
                const ny = dx / len;

                // Apply offset
                const sign = direction === 'left' ? 1.0 : -1.0;
                const ox = nx * offsetDist * sign;
                const oy = ny * offsetDist * sign;

                offsetSegments.push({
                    command: seg.command,
                    start: { x: seg.start.x + ox, y: seg.start.y + oy, z: seg.start.z },
                    end: { x: seg.end.x + ox, y: seg.end.y + oy, z: seg.end.z },
                    raw: seg,
                    normal: { x: nx * sign, y: ny * sign }
                });
            } else if (seg.command === 'G2' || seg.command === 'G3') {
                // Arc segment offset
                const isCW = seg.isCW;
                
                // If CCW: Left is inwards (radius decreases), Right is outwards (radius increases)
                // If CW: Left is outwards (radius increases), Right is inwards (radius decreases)
                let radiusOffset = 0;
                if (direction === 'left') {
                    radiusOffset = isCW ? offsetDist : -offsetDist;
                } else {
                    radiusOffset = isCW ? -offsetDist : offsetDist;
                }

                // Check if this is an inner corner arc equal to the tool radius
                // If so, we bypass the arc to allow the adjacent segments to intersect in a sharp corner
                const isToolRadiusArc = Math.abs(seg.radius - offsetDist) < 0.1;
                const isShrinking = radiusOffset < 0;

                if (isToolRadiusArc && isShrinking) {
                    continue; // Bypass this arc
                }

                let newRadius = seg.radius + radiusOffset;
                
                // Clamp to tiny positive value if tool is too large
                if (newRadius < 0.001) {
                    newRadius = 0.001;
                }

                const scale = newRadius / seg.radius;
                
                const offsetStart = {
                    x: seg.center.x + (seg.start.x - seg.center.x) * scale,
                    y: seg.center.y + (seg.start.y - seg.center.y) * scale,
                    z: seg.start.z
                };

                const offsetEnd = {
                    x: seg.center.x + (seg.end.x - seg.center.x) * scale,
                    y: seg.center.y + (seg.end.y - seg.center.y) * scale,
                    z: seg.end.z
                };

                offsetSegments.push({
                    command: seg.command,
                    center: { ...seg.center },
                    radius: newRadius,
                    startAngle: seg.startAngle,
                    endAngle: seg.endAngle,
                    sweep: seg.sweep,
                    isCW: isCW,
                    startCorrected: offsetStart, // using standard naming
                    end: offsetEnd,
                    raw: seg
                });
            }
        }

        // Apply correct variable renaming
        for (const oSeg of offsetSegments) {
            if (oSeg.startCorrected) {
                oSeg.start = oSeg.startCorrected;
                delete oSeg.startCorrected;
            }
        }

        if (offsetSegments.length === 0) return [];

        // Step 2: Join offset segments at corners
        const points = [];
        const isClosed = this.isPathClosed(path);

        points.push({ ...offsetSegments[0].start });

        for (let i = 0; i < offsetSegments.length; i++) {
            const curr = offsetSegments[i];
            const next = offsetSegments[(i + 1) % offsetSegments.length];
            const isLast = (i === offsetSegments.length - 1);

            // Discretize current segment
            let currPts = [];
            if (curr.command === 'G0' || curr.command === 'G1') {
                currPts = [curr.start, curr.end];
            } else {
                // It's an arc
                currPts = this.discretizeArc(curr, tolerance);
            }

            // Add intermediate points (excluding start, which is already there, and we'll process the end separately)
            for (let j = 1; j < currPts.length - 1; j++) {
                points.push(currPts[j]);
            }

            // Now handle the joint at the end of the current segment
            const endPt = currPts[currPts.length - 1];

            if (isLast && !isClosed) {
                // If it's the last segment of an open path, just add the final point
                points.push(endPt);
                break;
            }

            // We need to join curr's end with next's start
            const B = curr.raw.end; // The original joint point
            const B1 = endPt; // Offset end point of curr
            const B2 = next.start; // Offset start point of next

            // Exit tangent of current, entry tangent of next
            const T1 = this.getSegmentTangent(curr.raw, 'end');
            const T2 = this.getSegmentTangent(next.raw, 'start');

            const cross = T1.x * T2.y - T1.y * T2.x;
            const sign = direction === 'left' ? 1.0 : -1.0;

            // Inside corner (overlap) vs Outside corner (gap)
            // Left offset: CCW (cross > 0) is Inside, CW (cross < 0) is Outside
            // Right offset: CCW (cross > 0) is Outside, CW (cross < 0) is Inside
            const isInsideCorner = (sign * cross > 0);

            if (isInsideCorner) {
                // Solve for line-line intersection of tangents
                // Line 1: B1 + u * T1
                // Line 2: B2 + v * T2
                const det = T2.x * T1.y - T2.y * T1.x;
                let intersection = null;

                if (Math.abs(det) > 1e-5) {
                    const u = ((B2.x - B1.x) * T2.y - (B2.y - B1.y) * T2.x) / det;
                    
                    // Limit miter spike to 3x offset distance
                    if (Math.abs(u) < offsetDist * 3) {
                        intersection = {
                            x: B1.x + u * T1.x,
                            y: B1.y + u * T1.y,
                            z: B1.z
                        };
                    }
                }

                // Fallback to average if parallel or spike is too long
                if (!intersection) {
                    intersection = {
                        x: (B1.x + B2.x) / 2,
                        y: (B1.y + B2.y) / 2,
                        z: (B1.z + B2.z) / 2
                    };
                }

                points.push(intersection);
                next.start = { ...intersection }; // Update next segment's start to meet the corner
            } else {
                // Outside corner: Insert a rounded arc around B from B1 to B2
                const dx1 = B1.x - B.x;
                const dy1 = B1.y - B.y;
                const dx2 = B2.x - B.x;
                const dy2 = B2.y - B.y;

                const r1 = Math.sqrt(dx1*dx1 + dy1*dy1);
                const r2 = Math.sqrt(dx2*dx2 + dy2*dy2);

                const startAngle = Math.atan2(dy1, dx1);
                let endAngle = Math.atan2(dy2, dx2);

                // Determine sweep direction
                // For an outside corner, the sweep should go the same way as the turn
                const isCW = (direction === 'left'); // Left offset outside corner sweeps CW

                let sweep = isCW ? (startAngle - endAngle) : (endAngle - startAngle);
                if (sweep < 0) sweep += 2 * Math.PI;

                const cornerArc = {
                    center: { ...B },
                    radius: (r1 + r2) / 2,
                    startAngle: startAngle,
                    endAngle: endAngle,
                    sweep: sweep,
                    isCW: isCW,
                    start: B1,
                    end: B2
                };

                const cornerPts = this.discretizeArc(cornerArc, tolerance);
                for (const pt of cornerPts) {
                    points.push(pt);
                }
            }
        }

        // For closed paths, ensure start matches end exactly
        if (isClosed && points.length > 0) {
            points[0] = { ...points[points.length - 1] };
        }

        return points;
    }

    static getSegmentTangent(seg, position) {
        if (seg.command === 'G0' || seg.command === 'G1') {
            const dx = seg.end.x - seg.start.x;
            const dy = seg.end.y - seg.start.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            return len > 0.001 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 };
        } else {
            // Arc tangent
            const pt = position === 'start' ? seg.start : seg.end;
            const rx = pt.x - seg.center.x;
            const ry = pt.y - seg.center.y;
            const rLen = Math.sqrt(rx*rx + ry*ry);
            
            if (rLen < 0.001) return { x: 1, y: 0 };

            // Unit normal pointing outward
            const ux = rx / rLen;
            const uy = ry / rLen;

            // Tangent is perpendicular to radius. 
            // CCW sweep: tangent points left of radius (tangent = (-uy, ux))
            // CW sweep: tangent points right of radius (tangent = (uy, -ux))
            if (seg.isCW) {
                return { x: uy, y: -ux };
            } else {
                return { x: -uy, y: ux };
            }
        }
    }
}

// Export class
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DXFGenerator;
} else {
    window.DXFGenerator = DXFGenerator;
}
