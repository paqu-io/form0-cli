/**
 * Lightweight CSV parsing and stringification utilities.
 * Supports RFC4180-style CSV with quoted fields, embedded commas, and newlines.
 */

/**
 * Parse CSV text into an array of rows, each being an array of cell strings.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  if (typeof text !== 'string') {
    throw new TypeError('parseCsv expects a string input');
  }

  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let inQuotes = false;

  const sanitized = text.replace(/^\uFEFF/, ''); // Strip BOM if present

  for (let i = 0; i < sanitized.length; i++) {
    const char = sanitized[i];

    if (inQuotes) {
      if (char === '"') {
        if (sanitized[i + 1] === '"') {
          currentCell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }

    if (char === '\n') {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      continue;
    }

    if (char === '\r') {
      // Normalize CRLF -> treat CR as part of CRLF only
      if (sanitized[i + 1] === '\n') {
        i += 1;
      }
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      continue;
    }

    currentCell += char;
  }

  // Append last cell/row
  currentRow.push(currentCell);
  // Avoid trailing blank rows when file ends with newline
  if (!(currentRow.length === 1 && currentRow[0] === '' && rows.length > 0)) {
    rows.push(currentRow);
  }

  if (inQuotes) {
    throw new Error('Malformed CSV: unmatched quote detected');
  }

  return rows;
}

/**
 * Convert CSV rows to objects using the first row as headers.
 * @param {string[][]} rows
 * @returns {Array<Record<string, string>>}
 */
export function rowsToObjects(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const headers = rows[0];
  return rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index] !== undefined ? row[index] : '';
    });
    return obj;
  });
}

/**
 * Convert header + row objects into CSV string.
 * @param {string[]} headers
 * @param {Array<Record<string, string>>} rows
 * @returns {string}
 */
export function stringifyCsv(headers, rows) {
  const dataRows = rows.map((row) => headers.map((header) => row[header] ?? ''));
  return stringifyCsvFromMatrix([headers, ...dataRows]);
}

/**
 * Convert matrix of cell strings into CSV text.
 * @param {string[][]} matrix
 * @returns {string}
 */
export function stringifyCsvFromMatrix(matrix) {
  const lines = matrix.map((row) =>
    row
      .map((cell) => {
        const value = cell ?? '';
        const needsQuoting = /[",\n\r]/.test(value) || /^\s|\s$/.test(value);
        if (!needsQuoting) {
          return value;
        }
        return '"' + value.replace(/"/g, '""') + '"';
      })
      .join(',')
  );
  return lines.join('\n');
}
