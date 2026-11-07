// Excel/CSV reader for "Load a price list", bundled to lib/xlsx.js and loaded only when a spreadsheet is chosen.
import { read, utils } from 'xlsx';
window.XLSX = { read, utils };
