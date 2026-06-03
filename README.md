# G-Code to DXF Polyline Converter

A premium, interactive, browser-based tool to convert CNC/Laser G-code toolpaths back into clean, editable CAD vector drawings. 

**[🔗 Try it here!](https://antsmartti.github.io/txt2dxf/)**

## Why?
Generating G-code toolpaths from vector tools (*VCarve, Aspire, Fusion360, AutoCAD, etc.*) is typically a one-way operation. If you lose your original design files (`.crv`, `.3dm`, `.f3d`) due to corruption or accidental deletion, it is extremely difficult to reconstruct them. 

This tool solves this issue by reverse-engineering your G-code back into CAD-ready vectors, allowing you to edit the design and salvage your project.

## Key Features
* **Zero Dependencies & Offline-First**: Built with pure HTML5, CSS3, and Vanilla JS. Runs entirely in your browser with zero installation, zero server calls, and complete offline privacy.
* **Joined Polylines**: Connected cut moves are grouped into DXF `POLYLINE` entities, meaning vectors are pre-joined when imported back into your CAD/CAM software.
* **Cutter Compensation (Offsetting)**: Specify your mill diameter and offset direction (Left/Right) to offset the cutter paths back to the original CAD geometry.
* **Sharp-Corner Recovery**: Automatically detects filleted inner corners that match the cutter radius. It bypasses the shrinking arc and extends the tangents to reconstruct the original **sharp corner**.
* **Interactive Canvas Viewer**: Pan, zoom centered on the cursor, view coordinates, and check work coordinate systems (WCS) with a dynamic adaptive grid and real-time cutter cursor.
* **Configurable Curve Tolerance**: Control how finely arcs and offset corners are discretized (default `0.2mm`) before exporting.
* **Smart Layering**: Organise your DXF layers by Z-depth, tool index, motion type, or single combined layer.
* **Live G-Code Editor**: View and edit the raw G-code text side-by-side with real-time visual updates.
* **Multi-File Merging**: Load and merge multiple G-code files together into a single DXF document.

## How to Run offline
Just open the `index.html` file directly in any modern web browser, or serve it locally:
```bash
npx http-server -p 8080
```
Then upload your `.gcode`, `.nc`, `.txt`, or `.tap` files, set your mill diameter, and download the DXF file!
