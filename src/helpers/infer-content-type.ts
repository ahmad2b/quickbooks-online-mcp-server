import path from "node:path";

const EXT_TO_MIME: Readonly<Record<string, string>> = {
  ".ai": "application/postscript",
  ".eps": "application/postscript",
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpg",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".rtf": "text/rtf",
  ".tif": "image/tif",
  ".txt": "text/plain",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml": "text/xml",
};

export function inferContentType(...candidateNames: Array<string | undefined>): string | null {
  for (const name of candidateNames) {
    if (!name) continue;
    const mime = EXT_TO_MIME[path.extname(name).toLowerCase()];
    if (mime) return mime;
  }
  return null;
}
