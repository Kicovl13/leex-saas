#!/usr/bin/env node
/**
 * Genera una plantilla .docx compatible con docxtemplater.
 * Las etiquetas están en un solo run para evitar "Duplicate open/close tag".
 * Ejecutar desde apps/api: node scripts/generate-template-docx.mjs
 */

import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PizZip = require('pizzip');

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', '..', '..', 'plantilla-contrato-servicios.docx');

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
</w:styles>`;

const CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>LEX-CLOUD</dc:creator><cp:lastModifiedBy>LEX-CLOUD</cp:lastModifiedBy></cp:coreProperties>`;

const APP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>LEX-CLOUD</Application></Properties>`;

// IMPORTANTE: cada párrafo con etiquetas las tiene en un solo <w:r><w:t> para evitar runs partidos
const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">CONTRATO DE PRESTACIÓN DE SERVICIOS PROFESIONALES</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve"></w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">En fecha {{today_date}}, el despacho LEX-CLOUD Legal y el cliente {{client_name}}, con identificación {{client_id_number}}, acuerdan el inicio de la representación legal para el asunto denominado {{matter_title}}.</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">El cliente acepta los términos y condiciones para el proceso de tipo {{matter_court}}.</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve"></w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Firma del Cliente: __________________________</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/><w:docGrid w:linePitch="360"/></w:sectPr>
  </w:body>
</w:document>`;

const zip = new PizZip();
zip.file('[Content_Types].xml', CONTENT_TYPES);
zip.file('_rels/.rels', RELS);
zip.file('word/_rels/document.xml.rels', DOC_RELS);
zip.file('word/document.xml', DOCUMENT);
zip.file('word/styles.xml', STYLES);
zip.file('docProps/core.xml', CORE);
zip.file('docProps/app.xml', APP);

try {
  const buffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  writeFileSync(OUT, buffer);
  console.log('Plantilla generada:', OUT);
} catch (e) {
  console.error('Error:', e);
  process.exit(1);
}
