import JSZip from "jszip";

export type DocxArchive = {
  zip: JSZip;
  documentXml: string;
  stylesXml: string | undefined;
  numberingXml: string | undefined;
  footnotesXml: string | undefined;
  relsXml: string | undefined;
};

/**
 * Load and validate a DOCX archive, extracting key XML files.
 */
export async function loadDocxArchive(input: ArrayBuffer | Uint8Array | Buffer): Promise<DocxArchive> {
  const zip = await JSZip.loadAsync(input);
  
  const documentXml = await zip.file("word/document.xml")?.async("text");
  if (!documentXml) {
    throw new Error("Invalid .docx: missing word/document.xml");
  }

  const stylesXml = await zip.file("word/styles.xml")?.async("text");
  const numberingXml = await zip.file("word/numbering.xml")?.async("text");
  const footnotesXml = await zip.file("word/footnotes.xml")?.async("text");
  const relsXml = await zip.file("word/_rels/document.xml.rels")?.async("text");

  return {
    zip,
    documentXml,
    stylesXml,
    numberingXml,
    footnotesXml,
    relsXml,
  };
}

/**
 * Extract media assets (images) from the DOCX archive.
 */
export async function extractMediaAssets(zip: JSZip): Promise<Map<string, Uint8Array>> {
  const assets = new Map<string, Uint8Array>();
  
  const mediaFolder = zip.folder("word/media");
  if (!mediaFolder) return assets;
  
  const files: string[] = [];
  mediaFolder.forEach((relativePath) => {
    files.push(relativePath);
  });
  
  for (const relativePath of files) {
    const file = zip.file(`word/media/${relativePath}`);
    if (file) {
      const data = await file.async("uint8array");
      // Store with path relative to output: media/image1.png
      assets.set(`media/${relativePath}`, data);
    }
  }
  
  return assets;
}
