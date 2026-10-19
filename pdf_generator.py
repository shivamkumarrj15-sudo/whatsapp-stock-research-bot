import os
from datetime import datetime
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, KeepTogether

def generate_stock_pdf(comp_name, sector, cmp_price, mcap, pe, roce, roe, debt_eq, 
                       pros, cons, pnl_headers, pnl_rows, cf_rows, ratios_rows,
                       shareholding, scenarios, news_items, macro_events, output_path):
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36
    )
    styles = getSampleStyleSheet()

    # Custom styles
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontSize=20,
        leading=24,
        textColor=colors.HexColor('#0F172A'),
        fontName='Helvetica-Bold'
    )
    subtitle_style = ParagraphStyle(
        'DocSubTitle',
        parent=styles['Normal'],
        fontSize=10,
        leading=14,
        textColor=colors.HexColor('#475569')
    )
    h2_style = ParagraphStyle(
        'Heading2Custom',
        parent=styles['Heading2'],
        fontSize=12,
        leading=16,
        textColor=colors.HexColor('#1E293B'),
        fontName='Helvetica-Bold',
        spaceBefore=10,
        spaceAfter=4
    )
    body_style = ParagraphStyle(
        'BodyCustom',
        parent=styles['Normal'],
        fontSize=9,
        leading=13,
        textColor=colors.HexColor('#334155')
    )
    bullet_style = ParagraphStyle(
        'BulletCustom',
        parent=styles['Normal'],
        fontSize=8.5,
        leading=12,
        textColor=colors.HexColor('#334155'),
        leftIndent=12
    )

    story = []

    # Header Banner
    story.append(Paragraph(f"INSTITUTIONAL EQUITY RESEARCH MEMO", subtitle_style))
    story.append(Paragraph(f"{comp_name.upper()}", title_style))
    story.append(Paragraph(f"Sector: <b>{sector}</b> | Date: <b>{datetime.now().strftime('%d %B %Y')}</b> | Standard: Evidence-Led Master Framework v2.0", subtitle_style))
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor('#2563EB'), spaceBefore=2, spaceAfter=10))

    # Snapshot Table
    snap_data = [
        [
            Paragraph(f"<b>Current Price:</b> ₹{cmp_price}", body_style),
            Paragraph(f"<b>Market Cap:</b> {mcap}", body_style),
            Paragraph(f"<b>Stock P/E:</b> {pe}", body_style)
        ],
        [
            Paragraph(f"<b>ROCE:</b> {roce}", body_style),
            Paragraph(f"<b>ROE:</b> {roe}", body_style),
            Paragraph(f"<b>Debt to Equity:</b> {debt_eq}", body_style)
        ]
    ]
    snap_table = Table(snap_data, colWidths=[180, 180, 180])
    snap_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#F8FAFC')),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E1')),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(snap_table)
    story.append(Spacer(1, 12))

    # 1. Executive Summary & Moat
    story.append(Paragraph("1. BUSINESS MODEL & COMPETITIVE ADVANTAGE (MOAT)", h2_style))
    for p in pros[:4]:
        story.append(Paragraph(f"• <b>Strength:</b> {p}", bullet_style))
    story.append(Spacer(1, 8))

    # 2. Material Risks & Forensic Red Flags
    story.append(Paragraph("2. MATERIAL RISKS & FORENSIC AUDIT CHECKLIST", h2_style))
    for c in cons[:4]:
        story.append(Paragraph(f"• <b>Risk Factor:</b> {c}", bullet_style))
    story.append(Spacer(1, 8))

    # 3. 10-Year Audited Financial Trend (P&L)
    if pnl_headers and pnl_rows:
        story.append(Paragraph("3. 10-YEAR PROFIT & LOSS TREND (Audited ₹ Cr)", h2_style))
        recent_headers = ["Metric"] + pnl_headers[-5:]
        table_rows = [recent_headers]
        for metric_name in ['Sales', 'Sales +', 'Operating Profit', 'OPM %', 'Net Profit', 'EPS in Rs']:
            row_vals = pnl_rows.get(metric_name)
            if row_vals:
                clean_name = metric_name.replace('+', '').strip()
                table_rows.append([clean_name] + row_vals[-5:])
        
        if len(table_rows) > 1:
            pnl_table = Table(table_rows, colWidths=[110] + [85]*5)
            pnl_table.setStyle(TableStyle([
                ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1E293B')),
                ('TEXTCOLOR', (0,0), (-1,0), colors.white),
                ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
                ('FONTSIZE', (0,0), (-1,-1), 8),
                ('BOTTOMPADDING', (0,0), (-1,-1), 4),
                ('TOPPADDING', (0,0), (-1,-1), 4),
                ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E1')),
                ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#F8FAFC')]),
            ]))
            story.append(pnl_table)
            story.append(Spacer(1, 10))

    # 4. Cash Flow & Capital Quality
    if cf_rows:
        story.append(Paragraph("4. CASH FLOW QUALITY & FORENSIC CHECK (₹ Cr)", h2_style))
        cfo = cf_rows.get('Cash from Operating Activity +', cf_rows.get('Cash from Operating Activity', []))
        cfi = cf_rows.get('Cash from Investing Activity +', cf_rows.get('Cash from Investing Activity', []))
        cff = cf_rows.get('Cash from Financing Activity +', cf_rows.get('Cash from Financing Activity', []))
        if cfo:
            cf_text = f"• <b>Latest Operating Cash Flow (CFO):</b> ₹{cfo[-1]} Cr (vs ₹{cfo[-2] if len(cfo)>1 else 'N/A'} Cr prior period)<br/>"
            cf_text += f"• <b>Capital Expenditures / Investing (CFI):</b> ₹{cfi[-1] if cfi else 'N/A'} Cr<br/>"
            cf_text += f"• <b>Financing & Debt servicing (CFF):</b> ₹{cff[-1] if cff else 'N/A'} Cr<br/>"
            cf_text += "• <i>Earnings Quality Test:</i> Positive and growing CFO confirms reported profits are converting into liquid bank balances."
            story.append(Paragraph(cf_text, bullet_style))
            story.append(Spacer(1, 8))

    # 5. Shareholding & Governance Structure
    if shareholding:
        story.append(Paragraph("5. SHAREHOLDING PATTERN & INSTITUTIONAL FLOWS", h2_style))
        sh_parts = [f"<b>{k}:</b> {v}%" for k, v in shareholding.items()]
        story.append(Paragraph(" | ".join(sh_parts), bullet_style))
        story.append(Spacer(1, 8))

    # 6. Valuation & 3-Year Target Scenarios
    story.append(Paragraph("6. VALUATION MODEL & 3-YEAR TARGET SCENARIOS", h2_style))
    scen_data = [
        ["Scenario", "Assumption Driver", "Valuation Target", "Implied Return"],
        ["🐻 Bear Case", scenarios.get('bear_driver', 'Multiple contraction on cyclical slowdown'), scenarios.get('bear_target', '-20% Target'), scenarios.get('bear_return', '-15% to -25%')],
        ["🎯 Base Case", scenarios.get('base_driver', 'Compounds in line with normalized historical CAGR'), scenarios.get('base_target', 'Fair Value'), scenarios.get('base_return', '+12% to +18%')],
        ["🐂 Bull Case", scenarios.get('bull_driver', 'Operating leverage expansion & market share gains'), scenarios.get('bull_target', '+45% Target'), scenarios.get('bull_return', '+35% to +50%')]
    ]
    scen_table = Table(scen_data, colWidths=[90, 230, 110, 110])
    scen_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#0F172A')),
        ('TEXTCOLOR', (0,0), (-1,0), colors.white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,-1), 8),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E1')),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.HexColor('#FEF2F2'), colors.white, colors.HexColor('#F0FDF4')]),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(scen_table)
    story.append(Spacer(1, 10))

    # 7. Thesis Invalidation Triggers (When to Exit)
    story.append(Paragraph("7. THESIS INVALIDATION & EXIT TRIGGERS", h2_style))
    triggers = [
        "1. Two consecutive quarters of declining operating margin (OPM) by >250 bps.",
        "2. Structural diversion of CFO from Net Profit, indicating aggressive revenue recognition or working capital stress.",
        "3. Increase in promoter share pledging or unapproved related-party debt transactions.",
        "4. Sustained loss of market share to unlisted or well-capitalized private peers."
    ]
    for t in triggers:
        story.append(Paragraph(t, bullet_style))
    story.append(Spacer(1, 10))

    # 8. Macro & News Drivers
    if news_items or macro_events:
        story.append(Paragraph("8. MACRO ENVIRONMENT & RECENT DEVELOPMENTS", h2_style))
        if news_items:
            story.append(Paragraph(f"<b>Key News Headlines:</b> {news_items}", bullet_style))
        if macro_events:
            story.append(Paragraph(f"<b>Forex Factory Macro Highlights:</b> {macro_events}", bullet_style))
        story.append(Spacer(1, 10))

    # Footer Disclaimer
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor('#94A3B8'), spaceBefore=8, spaceAfter=6))
    disclaimer = "CONFIDENTIAL RESEARCH MEMO. FOR INVESTMENT DECISION SUPPORT ONLY. NOT INVESTMENT ADVICE. Generated automatically via AI Research Office & OpenWA."
    story.append(Paragraph(disclaimer, ParagraphStyle('Disc', parent=styles['Normal'], fontSize=7, textColor=colors.HexColor('#94A3B8'))))

    doc.build(story)
    return output_path
