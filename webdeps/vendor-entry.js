// 앱에 포함되는 오프라인 라이브러리 묶음 (esbuild로 IIFE 번들 생성)
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import * as docx from 'docx-preview';
import { init as pptxInit } from 'pptx-preview';
import { Viewer as HwpViewer } from 'hwp.js';
import pako from 'pako';

window.XLSX = XLSX;
window.JSZip = JSZip;
window.docxPreview = docx;
window.pptxPreview = { init: pptxInit };
window.HwpViewer = HwpViewer;
window.pako = pako;

// 마크다운 렌더링 + HTML 정화(문서 속 스크립트 차단)
import { marked } from 'marked';
import DOMPurify from 'dompurify';
window.marked = marked;
window.DOMPurify = DOMPurify;
