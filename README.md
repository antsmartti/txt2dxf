# txt2dxf
A browser-based tool for converting a g-code txt file to dxf file

## Why?
Common workflow is to create a drawing in VCarve or Aspire, save the toolpaths to txt and open in Mach, LinuxCNC, etc. The issue is, generating the g-code toolpaths is a one-way operation - you can't import them back and edit the vectors. 

Another use case might be data loss - your crv files are accidentally deleted or corrupt. This allows you to salvage your vectors and get back in business. 

## How?
Just open up the tool in your browser, select your mill diameter and upload the txt file(s). Generate the DXF, download it and import the vectors. 
