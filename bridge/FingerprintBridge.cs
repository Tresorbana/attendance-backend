/*
 * FingerprintBridge.exe  —  AttendAI fingerprint capture bridge
 *
 * Streams each fingerprint scan to stdout as one JSON line:
 *   {"type":"status","status":"ready"}
 *   {"type":"scan","width":500,"height":500,"data":"<base64-grayscale>"}
 *   {"type":"quality","reject":"0x00000001"}
 *   {"type":"error","code":"0x80070005","message":"..."}
 *
 * Prerequisite (one-time admin setup):
 *   Run setup-scanner-admin.bat as Administrator to enable WbioSrvc.
 *
 * Build:
 *   build.bat
 */

using System;
using System.Runtime.InteropServices;
using System.ServiceProcess;
using System.Threading;

namespace AttendAI.Bridge
{
    static class Program
    {
        #region WBF constants and P/Invoke

        const uint WINBIO_TYPE_FINGERPRINT      = 0x00000008;
        const uint WINBIO_POOL_SYSTEM           = 0x00000001;
        const uint WINBIO_SESSION_FLAGS_DEFAULT = 0x00000000;
        const uint WINBIO_PURPOSE_ENROLL        = 0x00000001;
        const uint WINBIO_DATA_FLAG_RAW         = 0x00000001;
        const uint WINBIO_DATA_FLAG_INTERMEDIATE = 0x00000002;

        const uint ERROR_ACCESS_DENIED          = 0x80070005;

        const int  S_OK                    = 0;
        const uint WINBIO_E_BAD_CAPTURE    = 0x80098004;
        const uint WINBIO_E_CANCELED       = 0x80098008;
        const uint WINBIO_E_DEVICE_FAILURE = 0x8009800B;

        [DllImport("winbio.dll", CallingConvention = CallingConvention.Winapi)]
        static extern int WinBioOpenSession(
            uint     Factor,
            uint     PoolType,
            uint     Flags,
            IntPtr   UnitArray,
            UIntPtr  UnitCount,
            IntPtr   DatabaseId,
            out uint SessionHandle);

        [DllImport("winbio.dll", CallingConvention = CallingConvention.Winapi)]
        static extern int WinBioCaptureSample(
            uint      SessionHandle,
            uint      Purpose,
            uint      Flags,
            out uint  UnitId,
            out IntPtr Sample,
            out UIntPtr SampleSize,
            out uint  RejectDetail);

        [DllImport("winbio.dll", CallingConvention = CallingConvention.Winapi)]
        static extern int WinBioFree(IntPtr Address);

        [DllImport("winbio.dll", CallingConvention = CallingConvention.Winapi)]
        static extern int WinBioCloseSession(uint SessionHandle);

        #endregion

        #region JSON output helpers

        static readonly object WriteLock = new object();

        static void WriteJson(string json)
        {
            lock (WriteLock)
            {
                Console.WriteLine(json);
                Console.Out.Flush();
            }
        }

        static string Esc(string s)
        {
            if (s == null) return "";
            return s.Replace("\\", "\\\\")
                    .Replace("\"", "\\\"")
                    .Replace("\r", "\\r")
                    .Replace("\n", "\\n");
        }

        static void WriteStatus(string status)
        {
            WriteJson("{\"type\":\"status\",\"status\":\"" + Esc(status) + "\"}");
        }

        static void WriteError(string code, string message)
        {
            WriteJson("{\"type\":\"error\",\"code\":\"" + Esc(code) + "\",\"message\":\"" + Esc(message) + "\"}");
        }

        static void WriteQuality(uint reject)
        {
            WriteJson("{\"type\":\"quality\",\"reject\":\"0x" + reject.ToString("X8") + "\"}");
        }

        static void WriteScan(int width, int height, byte[] data)
        {
            string b64 = Convert.ToBase64String(data);
            WriteJson("{\"type\":\"scan\",\"width\":" + width + ",\"height\":" + height + ",\"data\":\"" + b64 + "\"}");
        }

        #endregion

        #region WbioSrvc startup

        static void EnsureWbioSrvcRunning()
        {
            try
            {
                using (ServiceController sc = new ServiceController("WbioSrvc"))
                {
                    if (sc.Status == ServiceControllerStatus.Running)
                        return;

                    sc.Start();
                    sc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(15));
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Could not start WbioSrvc: " + ex.Message);
            }
        }

        #endregion

        #region BIR parsing (WINBIO_BIR + ANSI 381)

        /*
         * WINBIO_BIR fixed header (32 bytes):
         *   [0..3]   HeaderBlock.Size
         *   [4..7]   HeaderBlock.Offset
         *   [8..11]  StandardDataBlock.Size
         *   [12..15] StandardDataBlock.Offset
         *   [16..19] VendorDataBlock.Size
         *   [20..23] VendorDataBlock.Offset
         *   [24..27] SignatureBlock.Size
         *   [28..31] SignatureBlock.Offset
         *
         * WINBIO_BDB_ANSI_381_HEADER (45 bytes at StandardDataBlock.Offset):
         *   [0..7]   RecordLength (8 bytes, little-endian)
         *   [8..11]  FormatOwner
         *   [12..15] FormatID
         *   [16..19] Version
         *   [20..21] RecordMultiplicity
         *   [22..23] ProductID
         *   [24..27] CaptureDeviceId
         *   [28..29] ImageAcquisitionLevel
         *   [30..31] HorzScanResolution
         *   [32..33] VertScanResolution
         *   [34..35] HorzImageResolution
         *   [36..37] VertImageResolution
         *   [38]     NumFingers
         *   [39]     Reserved
         *   [40]     ScaleUnits
         *   [41]     PixelDepth
         *   [42]     ImageCompressionAlg (0=none, 2=JPEG2K, 3=PNG, 4=WSQ)
         *   [43..44] Reserved2
         *
         * WINBIO_BDB_ANSI_381_RECORD (view record, starts at HEADER_SIZE):
         *   [0..3]   RecordLength
         *   [4]      HorzLineLength (reserved)
         *   [5]      VertLineLength (reserved)
         *   [6]      Quality
         *   [7]      ImpressionType
         *   [8..9]   ImageWidth  (big-endian)
         *   [10..11] ImageHeight (big-endian)
         *   [12]     AlgorithmType
         *   [13]     ImpressionType2
         *   [14+]    ImageData (Width * Height bytes when comprAlg == 0)
         */

        const int ANSI381_HEADER_SIZE = 45;
        const int ANSI381_VIEW_HDR    = 14;

        static bool ParseBir(byte[] bir, out int width, out int height, out byte[] imageData)
        {
            width = height = 0;
            imageData = null;

            if (bir == null || bir.Length < 32)
                return false;

            // Locate the standard data block
            int stdSize = BitConverter.ToInt32(bir, 8);
            int stdOff  = BitConverter.ToInt32(bir, 12);

            if (stdSize <= 0 || stdOff <= 0 || stdOff + stdSize > bir.Length)
            {
                // Try vendor block
                int vndSize = BitConverter.ToInt32(bir, 16);
                int vndOff  = BitConverter.ToInt32(bir, 20);
                if (vndSize > 0 && vndOff > 0 && vndOff + vndSize <= bir.Length)
                {
                    stdOff  = vndOff;
                    stdSize = vndSize;
                }
                else
                    return false;
            }

            if (stdSize < ANSI381_HEADER_SIZE + ANSI381_VIEW_HDR)
                return false;

            byte comprAlg = bir[stdOff + 42];

            // Read image dimensions from the first view record (big-endian per ANSI 381)
            int viewOff = stdOff + ANSI381_HEADER_SIZE;
            int imgW = (bir[viewOff + 8] << 8) | bir[viewOff + 9];
            int imgH = (bir[viewOff + 10] << 8) | bir[viewOff + 11];

            if (imgW <= 0 || imgW > 4096 || imgH <= 0 || imgH > 4096)
            {
                // Some drivers use little-endian
                imgW = BitConverter.ToUInt16(bir, viewOff + 8);
                imgH = BitConverter.ToUInt16(bir, viewOff + 10);
            }

            if (imgW <= 0 || imgW > 4096 || imgH <= 0 || imgH > 4096)
                return false;

            if (comprAlg != 0)
            {
                // Compressed image (PNG/JPEG2000/WSQ): skip the 45-byte ANSI 381 header
                // and 14-byte view record header — send only the actual compressed bytes.
                int imgDataOff = viewOff + ANSI381_VIEW_HDR;
                int imgDataLen = (stdOff + stdSize) - imgDataOff;
                if (imgDataLen <= 0) return false;
                imageData = new byte[imgDataLen];
                Array.Copy(bir, imgDataOff, imageData, 0, imgDataLen);
                width  = -1;
                height = comprAlg;
                return true;
            }

            // Uncompressed grayscale
            int imgOff  = viewOff + ANSI381_VIEW_HDR;
            int imgSize = imgW * imgH;

            if (imgOff + imgSize > bir.Length)
                return false;

            imageData = new byte[imgSize];
            Array.Copy(bir, imgOff, imageData, 0, imgSize);
            width  = imgW;
            height = imgH;
            return true;
        }

        #endregion

        static void Main(string[] args)
        {
            // Attempt to start WbioSrvc (requires the service to be configured
            // for non-admin start — see setup-scanner-admin.bat).
            EnsureWbioSrvcRunning();
            Thread.Sleep(500);

            // Open a WBF session for the system fingerprint pool
            uint sessionHandle;
            int openHr = WinBioOpenSession(
                WINBIO_TYPE_FINGERPRINT,
                WINBIO_POOL_SYSTEM,
                WINBIO_SESSION_FLAGS_DEFAULT,
                IntPtr.Zero,
                UIntPtr.Zero,
                IntPtr.Zero,
                out sessionHandle);

            if (openHr != S_OK)
            {
                string code = "0x" + ((uint)openHr).ToString("X8");
                WriteError(code,
                    "WinBioOpenSession failed (" + code + "). " +
                    "Run setup-scanner-admin.bat as Administrator once, then restart.");
                return;
            }

            WriteStatus("ready");

            // Start with raw capture; fall back to intermediate if access is denied.
            uint dataFlag = WINBIO_DATA_FLAG_RAW;

            // Capture loop — runs until stdin is closed or the session is cancelled
            while (true)
            {
                uint   unitId;
                IntPtr sample;
                UIntPtr sampleSize;
                uint   rejectDetail;

                int captHr = WinBioCaptureSample(
                    sessionHandle,
                    WINBIO_PURPOSE_ENROLL,
                    dataFlag,
                    out unitId,
                    out sample,
                    out sampleSize,
                    out rejectDetail);

                uint ucHr = (uint)captHr;

                if (captHr == S_OK)
                {
                    try
                    {
                        long sz  = (long)sampleSize;
                        var  bir = new byte[sz];
                        Marshal.Copy(sample, bir, 0, (int)sz);

                        int w, h;
                        byte[] img;
                        if (ParseBir(bir, out w, out h, out img))
                        {
                            WriteScan(w, h, img);
                        }
                        else
                        {
                            // Parsing failed: emit raw BIR for debugging
                            WriteScan(-2, (int)sz, bir);
                        }
                    }
                    catch (Exception ex)
                    {
                        WriteError("PARSE_ERROR", ex.Message);
                    }
                    finally
                    {
                        WinBioFree(sample);
                    }
                }
                else if (ucHr == WINBIO_E_BAD_CAPTURE)
                {
                    WriteQuality(rejectDetail);
                }
                else if (ucHr == WINBIO_E_CANCELED)
                {
                    WriteStatus("stopped");
                    break;
                }
                else if (ucHr == WINBIO_E_DEVICE_FAILURE)
                {
                    WriteError("DEVICE_FAILURE", "Scanner hardware error — check USB connection.");
                    Thread.Sleep(3000);
                }
                else if (ucHr == ERROR_ACCESS_DENIED && dataFlag == WINBIO_DATA_FLAG_RAW)
                {
                    // Raw capture blocked (requires SYSTEM/admin). Switch to intermediate
                    // mode (compressed image output) and reset the NestJS error counter.
                    Console.Error.WriteLine("[Bridge] Raw capture denied (0x80070005); switching to intermediate mode.");
                    dataFlag = WINBIO_DATA_FLAG_INTERMEDIATE;
                    WriteStatus("ready");
                }
                else if (ucHr == ERROR_ACCESS_DENIED && dataFlag == WINBIO_DATA_FLAG_INTERMEDIATE)
                {
                    // Both RAW and INTERMEDIATE modes are denied — the process lacks the
                    // required privilege (SYSTEM or WinBiometricGroup membership).
                    // Exit so NestJS can apply a long back-off instead of looping here.
                    Console.Error.WriteLine("[Bridge] Intermediate capture also denied (0x80070005). Run bridge/setup-scanner-admin.bat as Administrator.");
                    WriteError("ACCESS_DENIED_FATAL",
                        "Both raw and intermediate capture are access-denied (0x80070005). " +
                        "Run bridge/setup-scanner-admin.bat as Administrator to fix.");
                    break;
                }
                else
                {
                    WriteError("0x" + ucHr.ToString("X8"), "WinBioCaptureSample failed");
                    Thread.Sleep(1000);
                }
            }

            WinBioCloseSession(sessionHandle);
        }
    }
}
