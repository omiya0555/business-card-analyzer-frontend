import { useState, useRef, useCallback } from 'react'
import Webcam from 'react-webcam'
import { jsPDF } from "jspdf";
import html2canvas from 'html2canvas';
import QRCode from 'qrcode'

function App() {
  const [file, setFile] = useState(null)
  const [response, setResponse] = useState("")
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('upload')
  const [qrLoading, setQrLoading] = useState(false)
  const [qrCodeUrl, setQrCodeUrl] = useState("")
  const [downloadUrl, setDownloadUrl] = useState("")
  const [previewUrl, setPreviewUrl] = useState("")
  const [showWebcam, setShowWebcam] = useState(false)
  const [facingMode, setFacingMode] = useState('environment') // 'user' or 'environment'
  const resultRef = useRef(null)
  const fileInputRef = useRef(null)
  const webcamRef = useRef(null)

  const handleFileSelect = (selectedFile) => {
    setFile(selectedFile)
    if (selectedFile) {
      const url = URL.createObjectURL(selectedFile)
      setPreviewUrl(url)
    } else {
      setPreviewUrl("")
    }
  }

  // Webcamで撮影した画像をBlobに変換してファイルとして設定
  const capture = useCallback(() => {
    const imageSrc = webcamRef.current.getScreenshot()
    if (imageSrc) {
      // base64をBlobに変換
      fetch(imageSrc)
        .then(res => res.blob())
        .then(blob => {
          // BlobをFileオブジェクトに変換
          const file = new File([blob], 'webcam-capture.jpg', { type: 'image/jpeg' })
          handleFileSelect(file)
          setShowWebcam(false)
        })
        .catch(err => {
          console.error('Error converting webcam image:', err)
          alert('撮影した画像の処理に失敗しました')
        })
    }
  }, [webcamRef])

  // カメラの向きを切り替え
  const switchCamera = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user')
  }

  const handleUpload = async () => {
    if (!file) return alert("Please select a file")

    const formData = new FormData()
    formData.append("file", file)

    setLoading(true)
    setResponse("")
    setQrCodeUrl("")
    setDownloadUrl("")
    setActiveTab('result')
    
    try {
      //const res = await fetch("https://business-card-analyzer-backend.onrender.com/upload", {
      const res = await fetch("http://localhost:8000/upload", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(`HTTP ${res.status}: ${errorText}`)
      }

      const data = await res.json()
      
      if (data.error) {
        setResponse(`Error occurred: ${data.error}\n\nDetails:\n${data.details || 'No details available'}`)
        return
      }

      if (data.summary) {
        setResponse(data.summary)
      } else {
        setResponse("Analysis completed but could not retrieve results.")
      }

    } catch (err) {
      console.error("Upload error:", err)
      setResponse(`Communication error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const generateQRCode = async () => {
    if (!response || response.includes("Error")) {
      return alert("No valid output results available");
    }
    
    setQrLoading(true);
  
    try {
      // 1️⃣ html2canvasを使用してDOMを画像に変換
      const canvas = await html2canvas(resultRef.current, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#1f2937",
        width: 800,
        height: resultRef.current.scrollHeight,
        scrollX: 0,
        scrollY: 0
      });

      // 2️⃣ PDFインスタンス作成
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4"
      });

      // 3️⃣ キャンバスをPDFに追加
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;
      
      const ratio = Math.min(pageWidth / canvasWidth, pageHeight / canvasHeight);
      const scaledWidth = canvasWidth * ratio;
      const scaledHeight = canvasHeight * ratio;
      
      const x = (pageWidth - scaledWidth) / 2;
      const y = 0; // 上部マージン

      pdf.addImage(
        canvas.toDataURL('image/png'),
        'PNG',
        x,
        y,
        scaledWidth,
        scaledHeight
      );

      const sf = pdf.internal.scaleFactor;              // px -> mm
      const anchors = resultRef.current.querySelectorAll('a[href]');
      anchors.forEach(a => {
        const r = a.getBoundingClientRect();
        const base = resultRef.current.getBoundingClientRect();
        const relX = (r.left - base.left) * ratio;
        const relY = (r.top  - base.top ) * ratio;
        const w    = r.width  * ratio;
        const h    = r.height * ratio;
        pdf.link((x + relX) / sf, (y + relY) / sf, w / sf, h / sf, { url: a.href });
      });

      // 4️⃣ PDFをBlobとして生成
      const blob = pdf.output("blob");
      const formData = new FormData();
      formData.append("file", blob, "analysis_result.pdf");

      // 5️⃣ アップロード先URLの設定
      const uploadUrl = window.location.hostname === 'localhost' 
        ? "http://localhost:8000/upload-image" 
        : "https://business-card-analyzer-backend.onrender.com/upload-image";

      // 6️⃣ PDFをアップロード
      const uploadResponse = await fetch(uploadUrl, { 
        method: "POST", 
        body: formData 
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error(`Upload failed: ${uploadResponse.status} - ${errorText}`);
      }

      const uploadData = await uploadResponse.json();
      console.log("Upload response:", uploadData);
      
      if (!uploadData.success || !uploadData.download_url) {
        throw new Error("Backend returned invalid response");
      }

      // 7️⃣ QRコード生成
      const pdfDownloadUrl = uploadData.download_url;
      setDownloadUrl(pdfDownloadUrl);
      
      const qrCodeDataUrl = await QRCode.toDataURL(pdfDownloadUrl, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'M',
        type: 'image/png',
        quality: 0.92,
        rendererOpts: {
          quality: 0.92
        }
      });
      
      setQrCodeUrl(qrCodeDataUrl);

    } catch (error) {
      console.error("PDF/QR generation error:", error);
      alert("Error during PDF/QR generation: " + error.message);
    } finally {
      setQrLoading(false);
    }
  };

  const formatResponse = (text) => {
    let formatted = text;
    
    formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color: #ef4444; text-decoration: underline; font-weight: 500;">$1</a>');
    
    formatted = formatted.replace(/\n\n/g, '<br><br>');
    formatted = formatted.replace(/\n/g, '<br>');
    formatted = formatted.replace(/【([^】]+)】/g, '<strong style="color: #3b82f6; font-size: 16px; display: block; margin: 12px 0 6px 0; padding: 6px 12px; background: rgba(59, 130, 246, 0.1); border-left: 3px solid #ef4444; border-radius: 4px;">【$1】</strong>');
    formatted = formatted.replace(/---/g, '<hr style="border: none; height: 1px; background: rgba(156, 163, 175, 0.3); margin: 16px 0;">');
    formatted = formatted.replace(/- /g, '• ');
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong style="color: #ef4444; font-weight: 600;">$1</strong>');
    
    const linkRegex = /(^|[^">])(https?:\/\/[^\s<"']+)/g;
    formatted = formatted.replace(linkRegex, (match, prefix, url) => {
      if (prefix.includes('<a')) return match;
      return prefix + '<a href="' + url + '" target="_blank" rel="noopener noreferrer" style="color: #ef4444; text-decoration: underline; font-weight: 500;">' + url + '</a>';
    });
    
    return formatted;
  }

  const styles = {
    container: {
      width: '100vw',
      minHeight: '100vh',
      margin: 0,
      padding: 0,
      backgroundColor: '#111827',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      color: '#f9fafb'
    },
    header: {
      backgroundColor: '#1f2937',
      borderBottom: '1px solid rgba(75, 85, 99, 0.3)',
      padding: '0 16px',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      position: 'sticky',
      top: 0,
      zIndex: 100
    },
    tabContainer: {
      display: 'flex',
      gap: '6px',
      padding: '12px 0',
      justifyContent: 'center'
    },
    tab: (isActive) => ({
      padding: '10px 20px',
      border: 'none',
      borderRadius: '6px',
      backgroundColor: isActive ? '#ef4444' : '#374151',
      color: isActive ? '#ffffff' : '#d1d5db',
      cursor: 'pointer',
      fontWeight: isActive ? 600 : 500,
      fontSize: '14px',
      transition: 'all 0.2s ease',
      minWidth: '100px'
    }),
    content: {
      width: '100%',
      padding: '20px 16px',
      boxSizing: 'border-box',
      maxWidth: '800px',
      margin: '0 auto'
    },
    card: {
      backgroundColor: '#1f2937',
      borderRadius: '8px',
      padding: '24px',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      border: '1px solid #374151',
      marginBottom: '20px'
    },
    title: {
      marginTop: 0,
      marginBottom: '20px',
      color: '#f9fafb',
      fontSize: '20px',
      fontWeight: 600,
      textAlign: 'center'
    },
    uploadArea: {
      border: '2px dashed #ef4444',
      borderRadius: '8px',
      padding: '32px 16px',
      textAlign: 'center',
      backgroundColor: 'rgba(239, 68, 68, 0.05)',
      transition: 'all 0.2s ease',
      cursor: 'pointer',
      marginBottom: '20px'
    },
    fileInput: {
      display: 'none'
    },
    uploadButton: {
      backgroundColor: '#ef4444',
      color: 'white',
      border: 'none',
      padding: '12px 24px',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: 500,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      marginBottom: '12px',
      width: '100%'
    },
    cameraButton: {
      backgroundColor: '#3b82f6',
      color: 'white',
      border: 'none',
      padding: '12px 24px',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: 500,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      width: '100%'
    },
    webcamButton: {
      backgroundColor: '#10b981',
      color: 'white',
      border: 'none',
      padding: '12px 24px',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: 500,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      width: '100%',
      marginTop: '8px'
    },
    preview: {
      maxWidth: '100%',
      maxHeight: '300px',
      borderRadius: '6px',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      marginTop: '12px'
    },
    analyzeButton: {
      backgroundColor: '#10b981',
      color: 'white',
      border: 'none',
      padding: '12px 24px',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: 500,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      width: '100%',
      marginTop: '20px'
    },
    resultArea: {
      padding: '20px',
      border: '1px solid #374151',
      borderRadius: '6px',
      backgroundColor: '#111827',
      minHeight: '200px',
      whiteSpace: 'pre-wrap',
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: '14px',
      lineHeight: '1.6',
      color: '#f9fafb',
      wordWrap: 'break-word',
      overflowWrap: 'break-word',
      width: '100%',
      boxSizing: 'border-box'
    },
    qrSection: {
      textAlign: 'center',
      marginTop: '24px',
      padding: '20px',
      backgroundColor: '#1f2937',
      borderRadius: '8px',
      border: '1px solid #374151'
    },
    loadingSpinner: {
      display: 'inline-block',
      width: '16px',
      height: '16px',
      border: '2px solid rgba(255, 255, 255, 0.3)',
      borderRadius: '50%',
      borderTopColor: '#ffffff',
      animation: 'spin 1s ease-in-out infinite',
      marginRight: '6px'
    },
    webcamContainer: {
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000
    },
    webcamVideo: {
      width: '90%',
      maxWidth: '900px',
      height: 'auto',
      borderRadius: '8px',
      border: '2px solid #ef4444'
    },
    webcamControls: {
      marginTop: '20px',
      display: 'flex',
      gap: '12px',
      flexWrap: 'wrap',
      justifyContent: 'center'
    },
    webcamControlButton: {
      padding: '12px 24px',
      borderRadius: '6px',
      border: 'none',
      fontSize: '14px',
      fontWeight: 500,
      cursor: 'pointer',
      transition: 'all 0.2s ease'
    },
    captureButton: {
      backgroundColor: '#ef4444',
      color: 'white'
    },
    switchButton: {
      backgroundColor: '#6b7280',
      color: 'white'
    },
    cancelButton: {
      backgroundColor: '#374151',
      color: '#d1d5db'
    }
  }

  return (
    <div style={styles.container}>
      <style>
        {`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          @media (max-width: 768px) {
            .mobile-stack {
              flex-direction: column !important;
              gap: 8px !important;
            }
          }
        `}
      </style>

      {/* Webcam Modal */}
      {showWebcam && (
        <div style={styles.webcamContainer}>
          <Webcam
            audio={false}
            ref={webcamRef}
            screenshotFormat="image/jpeg"
            style={styles.webcamVideo}
            videoConstraints={{
              facingMode: facingMode
            }}
          />
          <div style={styles.webcamControls}>
            <button 
              onClick={capture}
              style={{
                ...styles.webcamControlButton,
                ...styles.captureButton
              }}
            >
              撮影
            </button>
            <button 
              onClick={switchCamera}
              style={{
                ...styles.webcamControlButton,
                ...styles.switchButton
              }}
            >
              カメラ切替
            </button>
            <button 
              onClick={() => setShowWebcam(false)}
              style={{
                ...styles.webcamControlButton,
                ...styles.cancelButton
              }}
            >
              キャンセル
            </button>
          </div>
          <div style={{ 
            marginTop: '12px', 
            color: '#9ca3af', 
            fontSize: '12px',
            textAlign: 'center'
          }}>
            {facingMode === 'environment' ? '背面カメラ' : '前面カメラ'}
          </div>
        </div>
      )}

      <div style={styles.header}>
        <div style={styles.tabContainer} className="mobile-stack">
          {['upload', 'result'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={styles.tab(activeTab === tab)}
            >
              {tab === 'upload' ? 'Upload' : 'Results'}
            </button>
          ))}
        </div>
      </div>

      <div style={styles.content}>
        {activeTab === 'upload' && (
          <div style={styles.card}>
            <h2 style={styles.title}>Business Card Image Upload</h2>
            
            <div 
              style={styles.uploadArea}
              onClick={() => fileInputRef.current?.click()}
            >
              <p style={{ fontSize: '16px', fontWeight: 600, color: '#f9fafb', marginBottom: '6px' }}>
                Select or drop file
              </p>
              <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '20px' }}>
                JPG, PNG, GIF supported
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '280px', margin: '0 auto' }}>
                <button style={styles.uploadButton}>
                  Select File
                </button>
                <button 
                  style={styles.cameraButton}
                  onClick={(e) => {
                    e.stopPropagation()
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.accept = 'image/*'
                    input.capture = 'environment'
                    input.onchange = (e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileSelect(e.target.files[0])
                      }
                    }
                    input.click()
                  }}
                >
                  Take Photo
                </button>
                <button 
                  style={styles.webcamButton}
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowWebcam(true)
                  }}
                >
                  Webcam
                </button>
              </div>
            </div>

            <input 
              ref={fileInputRef}
              type="file" 
              accept="image/*" 
              onChange={e => {
                if (e.target.files && e.target.files[0]) {
                  handleFileSelect(e.target.files[0])
                }
              }}
              style={styles.fileInput}
            />

            {previewUrl && (
              <div style={{ textAlign: 'center', marginTop: '20px' }}>
                <p style={{ fontSize: '14px', fontWeight: 500, color: '#f9fafb', marginBottom: '12px' }}>
                  Preview
                </p>
                <img 
                  src={previewUrl} 
                  alt="Preview" 
                  style={styles.preview}
                />
                <p style={{ fontSize: '12px', color: '#9ca3af', marginTop: '8px' }}>
                  {file?.name}
                </p>
              </div>
            )}

            {file && (
              <button 
                onClick={handleUpload} 
                disabled={loading}
                style={{
                  ...styles.analyzeButton,
                  opacity: loading ? 0.7 : 1,
                  cursor: loading ? 'not-allowed' : 'pointer'
                }}
              >
                {loading && <span style={styles.loadingSpinner}></span>}
                {loading ? "Analyzing..." : "Start Analysis"}
              </button>
            )}

            {loading && (
              <div style={{ 
                padding: '16px',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                borderRadius: '6px',
                color: '#60a5fa',
                marginTop: '20px',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '4px' }}>
                  Analyzing...
                </div>
                <div style={{ fontSize: '12px' }}>
                  Check progress in Results tab
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'result' && (
          <div style={styles.card}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              marginBottom: '20px',
              flexWrap: 'wrap',
              gap: '12px'
            }}>
              <h2 style={{ ...styles.title, marginBottom: 0, textAlign: 'left' }}>
                Analysis Results
              </h2>
              {response && !response.includes("Error") && (
                <button 
                  onClick={generateQRCode} 
                  disabled={qrLoading}
                  style={{
                    backgroundColor: qrLoading ? '#6b7280' : '#10b981',
                    color: qrLoading ? '#9ca3af' : 'white',
                    border: 'none',
                    padding: '10px 16px',
                    borderRadius: '6px',
                    cursor: qrLoading ? 'not-allowed' : 'pointer',
                    fontSize: '12px',
                    fontWeight: 500,
                    transition: 'all 0.2s ease'
                  }}
                >
                  {qrLoading ? 'Generating...' : 'Generate QR'}
                </button>
              )}
            </div>
            
            <div 
              ref={resultRef}
              style={styles.resultArea}
            >
              {response ? (
                <div 
                  dangerouslySetInnerHTML={{
                    __html: formatResponse(response)
                  }}
                />
              ) : (
                <div style={{ 
                  textAlign: 'center', 
                  color: '#6b7280',
                  padding: '40px 16px'
                }}>
                  {loading ? (
                    <div>
                      <div style={{ fontSize: '14px', marginBottom: '6px', color: '#f9fafb', fontWeight: 500 }}>
                        Analyzing...
                      </div>
                      <div style={{ fontSize: '12px' }}>
                        Results will appear in real-time
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: '14px', marginBottom: '6px', color: '#f9fafb', fontWeight: 500 }}>
                        Analysis results will appear here
                      </div>
                      <div style={{ fontSize: '12px' }}>
                        Select an image from Upload tab to start analysis
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {qrCodeUrl && (
              <div style={styles.qrSection}>
                <h3 style={{ 
                  color: '#f9fafb', 
                  fontSize: '16px', 
                  fontWeight: 600,
                  marginBottom: '12px'
                }}>
                  QR Code for PDF Download
                </h3>
                <p style={{ 
                  marginBottom: '16px', 
                  color: '#9ca3af', 
                  fontSize: '12px',
                  lineHeight: '1.5'
                }}>
                  Scan QR code with smartphone to download PDF
                </p>
                <div style={{
                  display: 'inline-block',
                  padding: '16px',
                  backgroundColor: '#ffffff',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                }}>
                  <img 
                    src={qrCodeUrl} 
                    alt="QR Code for PDF Download" 
                    style={{ 
                      display: 'block',
                      borderRadius: '4px',
                      width: '200px',
                      height: '200px'
                    }} 
                  />
                </div>
                <div style={{ 
                  marginTop: '16px', 
                  fontSize: '12px', 
                  color: '#9ca3af',
                  padding: '12px',
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  borderRadius: '6px',
                  border: '1px solid rgba(59, 130, 246, 0.2)'
                }}>
                  <p style={{ fontWeight: 500, marginBottom: '6px' }}>PDF Download URL:</p>
                  <a 
                    href={downloadUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{ 
                      wordBreak: 'break-all',
                      color: '#ef4444',
                      textDecoration: 'underline',
                      fontWeight: 500
                    }}
                  >
                    {downloadUrl}
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default App
