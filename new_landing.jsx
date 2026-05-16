  if (screen === "landing") return (
    <div style={{ minHeight: "100vh", background: "#FFFFFF", fontFamily: "'Inter', system-ui, sans-serif", display: "flex", flexDirection: "column" }}>
      <style>{FONTS + GLOBAL_CSS}</style>

      {/* HEADER */}
      <header style={{ position: "sticky", top: 0, zIndex: 100, height: 60, background: "#FFFFFF", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", padding: "0 40px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline" }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: "#0A1628", letterSpacing: "-0.3px" }}>FinSight</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: "#0D7A3E", letterSpacing: "-0.3px" }}>AI</span>
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: "#6B7280", fontWeight: 400 }}>finsightai.org</span>
      </header>

      {/* HERO */}
      <section style={{ background: "#0A1628", padding: "100px 24px", textAlign: "center" }}>
        <div className="fs-hero-content">
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.05)", borderRadius: 100, padding: "6px 16px" }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: "#FFFFFF", letterSpacing: "0.05em" }}>✦ Powered by Claude AI</span>
          </div>

          <h1 className="fs-hero-headline">
            Where finance meets intelligence.
          </h1>

          <p style={{ fontSize: 18, color: "rgba(255,255,255,0.65)", maxWidth: 500, margin: "20px auto 0", lineHeight: 1.6 }}>
            Upload any MCA filing or annual report. Get a verified Excel workbook and Word report — instantly.
          </p>

          <div className="fs-cta-row" style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 40, flexWrap: "wrap" }}>
            <button className="fs-cta-primary" onClick={() => document.getElementById('fs-public')?.scrollIntoView({ behavior: 'smooth' })}>
              Analyse a company →
            </button>
            <button className="fs-cta-secondary" onClick={() => document.getElementById('fs-private')?.scrollIntoView({ behavior: 'smooth' })}>
              Upload document
            </button>
          </div>

          <p style={{ marginTop: 28, fontSize: 13, color: "rgba(255,255,255,0.4)", letterSpacing: "0.02em" }}>
            Trusted for private equity · credit analysis · due diligence
          </p>
        </div>
      </section>

      {/* SOCIAL PROOF STRIP */}
      <div style={{ background: "#F5F7FA", borderTop: "1px solid #E5E7EB", borderBottom: "1px solid #E5E7EB", padding: "16px 24px", textAlign: "center" }}>
        <p style={{ fontSize: 13, color: "#6B7280", letterSpacing: "0.02em" }}>
          Analysis across &nbsp;
          <strong style={{ color: "#0A1628", fontWeight: 600 }}>Pharmaceuticals</strong>
          <span style={{ color: "#9CA3AF", margin: "0 10px" }}>·</span>
          <strong style={{ color: "#0A1628", fontWeight: 600 }}>Chemicals</strong>
          <span style={{ color: "#9CA3AF", margin: "0 10px" }}>·</span>
          <strong style={{ color: "#0A1628", fontWeight: 600 }}>Medical Devices</strong>
          <span style={{ color: "#9CA3AF", margin: "0 10px" }}>·</span>
          <strong style={{ color: "#0A1628", fontWeight: 600 }}>Manufacturing</strong>
          <span style={{ color: "#9CA3AF", margin: "0 10px" }}>·</span>
          <strong style={{ color: "#0A1628", fontWeight: 600 }}>Technology</strong>
        </p>
      </div>

      {/* PUBLIC COMPANY SECTION */}
      <section id="fs-public" style={{ background: "#FFFFFF", padding: "96px 24px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", textAlign: "center" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#0D7A3E", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Public Companies</div>
          <h2 style={{ fontSize: 40, fontWeight: 700, color: "#0A1628", letterSpacing: "-0.5px", lineHeight: 1.15, marginBottom: 12 }}>Analyse any listed company</h2>
          <p style={{ fontSize: 16, color: "#6B7280", lineHeight: 1.6, maxWidth: 480, margin: "0 auto 40px" }}>
            Quarterly, half-yearly, or annual financial analysis for any publicly listed company worldwide
          </p>

          {/* Period pills */}
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 24 }}>
            {[
              { id: "latest_quarter", label: "Quarterly" },
              { id: "half_yearly",    label: "Half-Yearly" },
              { id: "1_year",         label: "Annual" },
            ].map(p => (
              <button key={p.id}
                className={`fs-period-pill fs-btn${period === p.id ? '' : ' fs-period-pill-inactive'}`}
                onClick={() => setPeriod(p.id)}
                style={{
                  background: period === p.id ? "#0A1628" : "#FFFFFF",
                  color: period === p.id ? "#FFFFFF" : "#6B7280",
                  border: `1.5px solid ${period === p.id ? "#0A1628" : "#E5E7EB"}`,
                }}>
                {p.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div style={{ maxWidth: 640, margin: "0 auto 24px", display: "flex", background: "#FFFFFF", border: "1.5px solid #E5E7EB", borderRadius: 12, overflow: "hidden" }}>
            <input
              className="fs-input"
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === "Enter" && q.trim() && analyze(q.trim())}
              placeholder="Enter company name — Reliance, TCS, Apple..."
              style={{ flex: 1, height: 56, border: "none", outline: "none", padding: "0 20px", fontSize: 15, color: "#0A1628", fontFamily: "inherit", background: "transparent" }}
            />
            <button className="fs-search-btn fs-btn" onClick={() => q.trim() && analyze(q.trim())} disabled={!q.trim()} style={{ opacity: q.trim() ? 1 : 0.5 }}>
              Analyse →
            </button>
          </div>

          {/* Company chips */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
              <span style={{ fontSize: 12, color: "#9CA3AF", fontWeight: 500 }}>🇺🇸 US</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                {US_EX.map(c => <button key={c} className="fs-company-chip" onClick={() => analyze(c)}>{c}</button>)}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
              <span style={{ fontSize: 12, color: "#9CA3AF", fontWeight: 500 }}>🇮🇳 IN</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                {IN_EX.map(c => <button key={c} className="fs-company-chip" onClick={() => analyze(c)}>{c}</button>)}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PRIVATE COMPANY SECTION */}
      <section id="fs-private" style={{ background: "#F5F7FA", padding: "96px 24px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", textAlign: "center" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#0D7A3E", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Private Companies</div>
          <h2 style={{ fontSize: 40, fontWeight: 700, color: "#0A1628", letterSpacing: "-0.5px", lineHeight: 1.15, marginBottom: 12 }}>Analyse private company financials</h2>
          <p style={{ fontSize: 16, color: "#6B7280", lineHeight: 1.6, maxWidth: 480, margin: "0 auto 40px" }}>
            Upload MCA filing, XBRL document, or annual report PDF. Get institutional-grade output in under 60 seconds.
          </p>

          <PendingAnalysisBanner />

          {docReady ? (
            <DocumentReadyScreen docReady={docReady} onReset={() => { setDocReady(null); setPrivateDocStage('idle'); setPrivateDocFile(null); setScannedPdfWarn(null); }} />
          ) : scannedPdfWarn ? (
            <div style={{ maxWidth: 560, margin: "0 auto", background: "#FFFFFF", border: "1px solid #FCD34D", borderRadius: 16, padding: "32px 40px", boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04)" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#92400E', marginBottom: 10 }}>⚠ PDF Appears to Be Scanned</div>
              <div style={{ fontSize: 14, color: "#6B7280", lineHeight: 1.7, marginBottom: 20 }}>
                Only ~{scannedPdfWarn.charsPerPage} characters per page detected — this PDF likely contains scanned images. For best results, use an MCA portal XBRL/text-based PDF.
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <button onClick={() => { setScannedPdfWarn(null); setPrivateDocStage('idle'); setPrivateDocFile(null); }}
                  style={{ flex: 1, height: 44, borderRadius: 8, border: '1px solid #E5E7EB', background: '#F5F7FA', color: '#0A1628', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: "inherit" }}>
                  Cancel
                </button>
                <button onClick={() => runPrivateDocProcess(scannedPdfWarn.file, scannedPdfWarn.outputs)}
                  style={{ flex: 2, height: 44, borderRadius: 8, border: 'none', background: '#0A1628', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: "inherit" }}>
                  Proceed Anyway →
                </button>
              </div>
            </div>
          ) : (privateDocStage === 'uploaded' && !privateDocLoading) ? (
            <div style={{ maxWidth: 560, margin: "0 auto" }}>
              <DeliverableSelectionScreen
                file={privateDocFile}
                selectedOutputs={selectedOutputs}
                onToggle={(key) => setSelectedOutputs(prev => ({ ...prev, [key]: !prev[key] }))}
                onCancel={() => { setPrivateDocStage('idle'); setPrivateDocFile(null); setPrivateDocError(""); }}
                onGenerate={() => handlePrivateDocProcess(privateDocFile, selectedOutputs)}
              />
            </div>
          ) : privateDocLoading ? (
            <div style={{ maxWidth: 480, margin: "0 auto" }}>
              <ProcessingSteps progress={privateDocProgress} error={privateDocError} elapsedSecs={0} />
            </div>
          ) : (
            <>
              {/* Upload card */}
              <div
                style={{
                  maxWidth: 560, margin: "0 auto",
                  background: privateDocLoading ? "#FFFFFF" : ((() => { const [d, setD] = [false, () => {}]; return "#FFFFFF"; })()),
                }}
              >
                <PrivateDocUploadZone
                  onFileSelected={handlePrivateFileSelected}
                  isProcessing={privateDocLoading}
                  progress={privateDocProgress}
                  error={privateDocError}
                />
              </div>

              {/* Feature chips */}
              {!docReady && !privateDocLoading && privateDocStage !== 'uploaded' && !scannedPdfWarn && (
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 24, marginTop: 32 }}>
                  {["Excel Workbook", "Word Report", "SWOT Analysis", "Verification Matrix", "Ratio Benchmarking"].map(feat => (
                    <div key={feat} className="fs-feature-item">
                      <span style={{ color: "#0D7A3E", fontWeight: 700 }}>✓</span>
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {debugMessages.length > 0 && (
            <div style={{ maxWidth: 560, margin: "16px auto 0", background: '#fff', border: '1px solid #000', borderRadius: 4, padding: 10, maxHeight: 200, overflowY: 'auto', fontSize: 12, fontFamily: 'monospace', color: '#000', textAlign: 'left' }}>
              <div style={{ fontWeight: 'bold', marginBottom: 6 }}>DEBUG LOG</div>
              {debugMessages.map((msg, i) => <div key={i} style={{ marginBottom: 3 }}>{msg}</div>)}
            </div>
          )}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section style={{ background: "#FFFFFF", padding: "96px 24px", borderTop: "1px solid #E5E7EB" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", textAlign: "center" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#0D7A3E", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>The Process</div>
          <h2 style={{ fontSize: 40, fontWeight: 700, color: "#0A1628", letterSpacing: "-0.5px", lineHeight: 1.15, marginBottom: 64 }}>Three steps to institutional analysis</h2>

          <div className="fs-steps-row" style={{ display: "flex", alignItems: "flex-start", position: "relative", gap: 0 }}>
            <div className="fs-steps-connector" style={{ position: "absolute", top: 28, left: "calc(100% / 6)", right: "calc(100% / 6)", height: 0, borderTop: "1.5px dashed #E5E7EB", zIndex: 0 }} />
            {[
              {
                title: "Upload your document",
                desc: "PDF, XBRL, or Excel from MCA portal or annual report",
                icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 18V12M9 15L12 12L15 15" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
                num: "STEP 01",
              },
              {
                title: "Claude AI analyses",
                desc: "Extracts every financial figure with perfect accuracy",
                icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
                num: "STEP 02",
              },
              {
                title: "Download instantly",
                desc: "Verified Excel and Word report ready in seconds",
                icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M7 10L12 15L17 10" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 15V3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
                num: "STEP 03",
              },
            ].map((step, i) => (
              <div key={i} style={{ flex: 1, textAlign: "center", padding: "0 24px", position: "relative", zIndex: 1 }}>
                <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#0A1628", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto" }}>
                  {step.icon}
                </div>
                <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 16 }}>{step.num}</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#0A1628", marginTop: 12, letterSpacing: "-0.2px" }}>{step.title}</div>
                <div style={{ fontSize: 14, color: "#6B7280", lineHeight: 1.6, maxWidth: 220, margin: "8px auto 0" }}>{step.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ background: "#0A1628", padding: "48px 40px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="fs-footer-cols" style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 32 }}>
          <div>
            <div>
              <span style={{ fontSize: 16, fontWeight: 600, color: "#FFFFFF" }}>FinSight</span>
              <span style={{ fontSize: 16, fontWeight: 600, color: "#0D7A3E" }}>AI</span>
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>Institutional Financial Analysis</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", lineHeight: 1.8 }}>For research and educational purposes only.</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", lineHeight: 1.8 }}>Not investment advice.</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginTop: 8 }}>Developed by Aashni Shah and Hitansh Jhaveri</div>
          </div>
          <div className="fs-footer-right" style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>finsightai.org</div>
          </div>
        </div>
      </footer>
    </div>
  );

