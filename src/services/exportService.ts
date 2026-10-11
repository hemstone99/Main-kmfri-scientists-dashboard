import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DatabaseState, User } from '../types/kmfri.ts';

export interface ServerPdfExportPayload {
  type:
    | 'projects_summary'
    | 'single_project'
    | 'outputs_summary'
    | 'single_output'
    | 'directorate_summary';
  user: User;
  db: DatabaseState;
  targetId?: string;
  filterDirectorate?: string;
  filterStatus?: string;
  filename?: string;
}

export async function exportServerPdf(payload: ServerPdfExportPayload): Promise<void> {
  const response = await fetch('/api/exports/pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errText = `Server PDF generation failed (HTTP ${response.status}).`;
    try {
      const errJson = await response.json();
      if (errJson?.error) errText = errJson.error;
    } catch {
      // ignore json parse failure
    }
    throw new Error(errText);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeName =
    payload.filename ||
    `KMFRI_${payload.type.toUpperCase()}_${new Date().toISOString().slice(0, 10)}`;
  link.href = url;
  link.setAttribute('download', safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportToCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (!rows || rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.join(','),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const val = row[h] === null || row[h] === undefined ? '' : String(row[h]);
          return `"${val.replace(/"/g, '""')}"`;
        })
        .join(',')
    ),
  ];
  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportToExcel(
  filename: string,
  sheetName: string,
  rows: Record<string, unknown>[]
): void {
  const ws = XLSX.utils.json_to_sheet(
    rows.length > 0 ? rows : [{ Notice: 'No records matching current filter' }]
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export function exportToPdf(
  filename: string,
  reportTitle: string,
  subtitle: string,
  headers: string[],
  bodyRows: (string | number)[][]
): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  doc.setFontSize(14);
  doc.setTextColor(10, 37, 64);
  doc.text('KENYA MARINE AND FISHERIES RESEARCH INSTITUTE (KMFRI)', 40, 40);

  doc.setFontSize(11);
  doc.setTextColor(15, 118, 110);
  doc.text(reportTitle, 40, 58);

  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`${subtitle} · Generated UTC: ${new Date().toISOString()}`, 40, 74);

  autoTable(doc, {
    startY: 88,
    head: [headers],
    body:
      bodyRows.length > 0
        ? bodyRows
        : [['No database records found for the selected filter criteria.']],
    styles: { fontSize: 8, cellPadding: 5 },
    headStyles: { fillColor: [10, 37, 64], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  doc.save(`${filename}.pdf`);
}
