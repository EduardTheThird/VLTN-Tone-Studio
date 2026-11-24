export interface ChartMarkers {
  begin: string;
  end: string;
  error: string;
}

export function managedChartSpan(chart: string, markers: ChartMarkers): { begin: number; end: number; lines: string[] } | null {
  const lines = chart.split(/\r?\n/);
  const begins = lines.flatMap((line, index) => line === markers.begin ? [index] : []);
  const ends = lines.flatMap((line, index) => line === markers.end ? [index] : []);
  if (!begins.length && !ends.length) return null;
  if (begins.length !== 1 || ends.length !== 1 || begins[0] >= ends[0]) throw new Error(markers.error);
  return { begin: begins[0], end: ends[0], lines };
}

export function managedChartBlock(chart: string, markers: ChartMarkers): string {
  const span = managedChartSpan(chart, markers);
  return span ? span.lines.slice(span.begin, span.end + 1).join("\n") : "";
}

/** Replace the generated span while preserving all chart lines outside it. */
export function replaceManagedChart(chart: string, block: string, markers: ChartMarkers): string {
  const span = managedChartSpan(chart, markers);
  if (!span) return block ? `${chart}${chart && !chart.endsWith("\n") ? "\n" : ""}${block}` : chart;
  const newline = chart.includes("\r\n") ? "\r\n" : "\n";
  const before = span.lines.slice(0, span.begin);
  const after = span.lines.slice(span.end + 1);
  const prefix = before.length ? before.join(newline) + newline : "";
  return prefix + (block ? block.split("\n").join(newline) + (after.length ? newline : "") : "") + after.join(newline);
}
