export const reportViewer = {
  render(data) {
    try {
      const report = typeof data === 'string' ? JSON.parse(data) : data;
      let html = '<div class="report-viewer">';
      
      // Header
      html += `
        <div class="report-header">
          <div class="report-title">Build Report</div>
          <div class="report-status ${report.ok ? 'success' : 'error'}">${report.ok ? 'PASS' : 'FAIL'}</div>
        </div>
      `;

      // Summary
      html += `
        <div class="report-summary">
          <div class="rs-item">
            <div class="rs-label">Total</div>
            <div class="rs-value">${report.totalCount ?? 0}</div>
          </div>
          <div class="rs-item">
            <div class="rs-label">Passed</div>
            <div class="rs-value pass">${report.passCount ?? 0}</div>
          </div>
          <div class="rs-item">
            <div class="rs-label">Failed</div>
            <div class="rs-value fail">${report.failCount ?? 0}</div>
          </div>
        </div>
      `;

      // Stages/Results
      if (report.stages) {
        html += '<div class="report-stages">';
        report.stages.forEach(stage => {
          html += `
            <div class="report-stage">
              <div class="stage-header">
                <span class="stage-name">${stage.name}</span>
                <span class="stage-status ${stage.ok ? 'success' : 'error'}">${stage.ok ? 'OK' : 'FAIL'}</span>
              </div>
              ${stage.error ? `<div class="stage-error">${stage.error}</div>` : ''}
            </div>
          `;
        });
        html += '</div>';
      }

      html += '</div>';
      return html;
    } catch (e) {
      return `<div class="error">Invalid report data: ${e.message}</div>`;
    }
  }
};
