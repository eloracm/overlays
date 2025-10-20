#include "GPMFExtractor.h"
#include "GPMF_common.h"
#include "GPMF_parser.h"
#include "GPMF_mp4reader.h"
#include "GPMF_utils.h"
#include <filesystem>
#include <sstream>
#include <iostream>
#include <fstream>
#include <iomanip>
#include <cmath>
#include <nlohmann/json.hpp>
#include <ctime>
#include <algorithm>

using json = nlohmann::json;
namespace fs = std::filesystem;

// ------------------- Helpers -------------------

static bool parse_gpsu_to_epoch(const char *ts, double &out_epoch);
static std::string format_iso_from_epoch(double epoch_seconds);
static std::string GetMP4CreationTimeISO(const std::string &filename);
static bool extractGPSU(GPMF_stream *sub, double &gpsu_epoch, std::string &iso_out);
static bool extractGPSF(GPMF_stream *sub, double &rate_out);
static void extractGPS5(GPMF_stream *sub, double gpsu_epoch, double gpsf_rate, uint32_t counter, std::vector<GPSPoint> &gps_points);

// ------------------------------------------------------------
// Extract GPMF data from a single MP4, optionally trimming
// ------------------------------------------------------------
GPMFResult extractGPMFData(const std::string &filename)
{
    constexpr double speed_factor = 10.0; // keep the same TimeWarp factor used previously
    GPMFResult result;

    std::cout << "[GPMFExtractor] Processing: " << filename << std::endl;

    // Open MP4 and gather payload info
    size_t mp4 = OpenMP4Source((char *)filename.c_str(), MOV_GPMF_TRAK_TYPE, MOV_GPMF_TRAK_SUBTYPE, 0);
    if (!mp4)
    {
        std::cerr << "[ERROR] OpenMP4Source failed for " << filename << std::endl;
        return result;
    }

    size_t resHandle = GetPayloadResource(mp4, 0, 0);
    uint32_t payloadCount = GetNumberPayloads(mp4);
    std::cout << "[INFO] payloads=" << payloadCount << std::endl;

    std::vector<double> pts_times;    // raw payload in_t timestamps (video-side seconds)
    std::vector<double> gpsu_epochs;  // absolute GPSU epoch seconds discovered in payloads
    std::vector<GPSPoint> gps_points; // accumulated GPS points with iso_time (may be empty iso_time if not available)

    double last_payload_out = 0.0;

    // track first GPSU ISO we find
    std::string first_gpsu_iso;

    for (uint32_t i = 0; i < payloadCount; ++i)
    {
        uint32_t *payload = GetPayload(mp4, resHandle, i);
        uint32_t payloadSize = GetPayloadSize(mp4, i);
        if (!payload || payloadSize == 0)
            continue;

        double in_t = 0.0, out_t = 0.0;
        GetPayloadTime(mp4, i, &in_t, &out_t);
        pts_times.push_back(in_t);
        last_payload_out = out_t;

        // Parse GPMF payload (same approach as your original code)
        GPMF_stream gs;
        if (GPMF_OK == GPMF_Init(&gs, payload, payloadSize))
        {
            GPMF_ResetState(&gs);
            if (GPMF_OK == GPMF_FindNext(&gs, STR2FOURCC("STRM"), GPMF_RECURSE_LEVELS))
            {
                GPMF_stream sub;
                if (GPMF_OK == GPMF_CopyState(&gs, &sub))
                {
                    double gpsu_epoch = 0.0;
                    double gpsf_rate = 0.0;
                    std::string gpsu_iso;

                    if (GPMF_OK == GPMF_FindNext(&sub, STR2FOURCC("GPSU"), GPMF_RECURSE_LEVELS))
                    {
                        extractGPSU(&sub, gpsu_epoch, gpsu_iso);
                        if (gpsu_epoch != 0)
                            gpsu_epochs.push_back(gpsu_epoch);
                        if (first_gpsu_iso.empty())
                            first_gpsu_iso = format_iso_from_epoch(gpsu_epoch);
                    }

                    if (GPMF_OK == GPMF_FindNext(&sub, STR2FOURCC("GPSF"), GPMF_RECURSE_LEVELS))
                        extractGPSF(&sub, gpsf_rate);

                    // Fallback if GPSF not found or zero — GoPro GPS5 is usually 18Hz
                    if (gpsf_rate <= 0.0)
                    {
                        if (gpsu_epochs.size() >= 2)
                        {
                            // Estimate sampling rate based on total GPS5 samples / total elapsed GPS time
                            double total_time = gpsu_epochs.back() - gpsu_epochs.front();
                            unsigned __int64 total_samples = gps_points.size();
                            if (total_time > 0.0 && total_samples > 0.0)
                            {
                                gpsf_rate = total_samples / total_time;
                                // std::cerr << "[INFO] Estimated GPSF sampling rate: " << gpsf_rate << " Hz\n";
                            }
                        }
                        else
                        {
                            gpsf_rate = 18.0; // typical for GoPro GPS streams
                            // std::cerr << "[WARN] GPSF not found or zero, using default rate of 18Hz\n";
                        }
                    }
                    if (GPMF_OK == GPMF_FindNext(&sub, STR2FOURCC("GPS5"), GPMF_RECURSE_LEVELS))
                        extractGPS5(&sub, gpsu_epoch, gpsf_rate, i, gps_points);
                }
            }
            // free any resources inside gs if needed (GPMF_Free exists)
            GPMF_Free(&gs);
        } // if GPMF_Init
    } // for payloads

    if (resHandle)
        FreePayloadResource(mp4, resHandle);
    CloseSource(mp4);

    // --- Determine creation_time: prefer first GPSU if present, else filesystem time ---
    std::string creation_time_iso;
    if (!gpsu_epochs.empty())
        creation_time_iso = format_iso_from_epoch(gpsu_epochs.front());
    else
        creation_time_iso = GetMP4CreationTimeISO(filename);

    // Convert pts_kept to real-time corrected pts (pts_corrected = t * speed_factor)
    std::vector<double> pts_corrected;
    pts_corrected.reserve(pts_times.size());
    for (double t : pts_times)
    {
        pts_corrected.push_back(t * speed_factor);
    }

    uint32_t fr_numer = 0, fr_denom = 0;
    uint32_t frame_count = GetVideoFrameRateAndCount(mp4, &fr_numer, &fr_denom);
    double fps = fr_denom ? (double)fr_numer / (double)fr_denom : 0.0;

    // Fill result
    result.pts_times = std::move(pts_corrected); // real-time corrected pts list
    result.gpsu_epochs = gpsu_epochs;            // we didn't offset here; combining later will handle offsets
    result.gps_points = std::move(gps_points);
    result.fps = fps; // fps was not extracted here; you can add if needed via GetVideoFrameRateAndCount
    result.creation_time_iso = creation_time_iso;
    result.speed_factor = speed_factor;
    result.source_filename = std::filesystem::path(filename).filename().string();

    std::cout << "[GPMFExtractor] Found " << result.pts_times.size() << " pts (real-time seconds) and " << result.gps_points.size() << " gps samples.\n";

    return result;
}

// ------------------------------------------------------------
// Return the MP4 creation (or modification) time in ISO 8601
// Works on all compilers (MSVC, GCC, Clang)
// ------------------------------------------------------------
static std::string GetMP4CreationTimeISO(const std::string &filename)
{
    namespace fs = std::filesystem;
    std::string iso_time = "1970-01-01T00:00:00Z";

    try
    {
        auto ftime = fs::last_write_time(filename);

        // ✅ Portable conversion from file_time_type -> system_clock::time_point
        auto sctp = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
            ftime - fs::file_time_type::clock::now() + std::chrono::system_clock::now());

        std::time_t cftime = std::chrono::system_clock::to_time_t(sctp);

        std::tm gmt{};
#if defined(_WIN32)
        gmtime_s(&gmt, &cftime);
#else
        gmt = *std::gmtime(&cftime);
#endif

        char buf[32];
        std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &gmt);
        iso_time = buf;
    }
    catch (const std::exception &e)
    {
        std::cerr << "[WARN] Could not read creation time for " << filename
                  << " (" << e.what() << ")" << std::endl;
    }

    if (!iso_time.empty() && iso_time.back() == 'Z')
    {
        iso_time.pop_back(); // remove Z
        std::cerr << "[WARN] Adjusting GoPro creation_time to local zone: "
                  << iso_time << "\n";
    }
    return iso_time;
}
// ------------------------------------------------------------
// Convert a UNIX epoch (seconds since 1970) to ISO 8601 string
// ------------------------------------------------------------
static std::string format_iso_from_epoch(double epoch_seconds)
{
    if (epoch_seconds <= 0.0)
        return "1970-01-01T00:00:00Z";

    std::time_t t = static_cast<std::time_t>(epoch_seconds);
    std::tm gmt{};
#if defined(_WIN32)
    gmtime_s(&gmt, &t);
#else
    gmt = *std::gmtime(&t);
#endif

    char buf[32];
    std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &gmt);
    return std::string(buf);
}

// Parse GPSU formats like "251012144044.300" or "20251012144044.300"
// returns epoch seconds with fractional part (ms). Returns true on success.
static bool parse_gpsu_to_epoch(const char *ts, double &out_epoch)
{
    if (!ts)
        return false;
    std::string s(ts);
    // remove any trailing non-digit/non-dot characters and trim whitespace
    while (!s.empty() && std::isspace((unsigned char)s.back()))
        s.pop_back();
    // keep digits and dot only
    std::string digits;
    for (char c : s)
        if ((c >= '0' && c <= '9') || c == '.')
            digits.push_back(c);

    // split integer part and fractional milliseconds (optional)
    size_t dotpos = digits.find('.');
    std::string intpart = (dotpos == std::string::npos) ? digits : digits.substr(0, dotpos);
    std::string fracpart = (dotpos == std::string::npos) ? "" : digits.substr(dotpos + 1);

    // support two formats:
    //  - YYYYMMDDhhmmss  (length 14)
    //  - YYMMDDhhmmss    (length 12) -> assume 2000+YY
    if (intpart.size() != 14 && intpart.size() != 12)
        return false;

    int yr = 0, mo = 0, day = 0, hh = 0, mm = 0, ss = 0;
    if (intpart.size() == 14)
    {
        if (sscanf(intpart.c_str(), "%4d%2d%2d%2d%2d%2d", &yr, &mo, &day, &hh, &mm, &ss) != 6)
            return false;
    }
    else // 12 -> YYMMDDhhmmss
    {
        int yy = 0;
        if (sscanf(intpart.c_str(), "%2d%2d%2d%2d%2d%2d", &yy, &mo, &day, &hh, &mm, &ss) != 6)
            return false;
        yr = 2000 + yy; // assume 2000s (fits GoPro dates)
    }

    // fractional milliseconds
    int msec = 0;
    if (!fracpart.empty())
    {
        // take up to 3 digits for milliseconds
        std::string msstr = fracpart.substr(0, std::min<size_t>(3, fracpart.size()));
        while (msstr.size() < 3)
            msstr.push_back('0'); // pad to ms
        msec = atoi(msstr.c_str());
    }

    struct tm t{};
    t.tm_year = yr - 1900;
    t.tm_mon = mo - 1;
    t.tm_mday = day;
    t.tm_hour = hh;
    t.tm_min = mm;
    t.tm_sec = ss;
#if defined(_WIN32)
    time_t sec = _mkgmtime(&t);
#else
    time_t sec = timegm(&t);
#endif
    if (sec == (time_t)-1)
        return false;

    out_epoch = (double)sec + (double)msec / 1000.0;
    return true;
}

// ------------------------------------------------------------
// Extract GPSU UTC timestamp (to epoch + ISO string)
// ------------------------------------------------------------
static bool extractGPSU(GPMF_stream *sub, double &gpsu_epoch, std::string &iso_out)
{
    char tsbuf[64] = {0};
    bool got_ts = false;

    if (GPMF_OK == GPMF_ScaledData(sub, tsbuf, sizeof(tsbuf) - 1, 0, 1, GPMF_TYPE_UTC_DATE_TIME))
        got_ts = true;
    else if (GPMF_OK == GPMF_ScaledData(sub, tsbuf, sizeof(tsbuf) - 1, 0, 1, GPMF_TYPE_STRING_ASCII))
        got_ts = true;

    if (!got_ts)
        return false;

    double epoch = 0.0;
    if (!parse_gpsu_to_epoch(tsbuf, epoch))
        return false;

    gpsu_epoch = epoch;
    iso_out = format_iso_from_epoch(epoch);
    return true;
}

// ------------------------------------------------------------
// Extract GPSF (sampling rate in Hz)
// ------------------------------------------------------------
static bool extractGPSF(GPMF_stream *sub, double &rate_out)
{
    rate_out = 0.0;

    double tmpd = 0.0;
    if (GPMF_OK == GPMF_ScaledData(sub, &tmpd, sizeof(tmpd), 0, 1, GPMF_TYPE_DOUBLE))
    {
        rate_out = tmpd;
        return true;
    }

    int32_t tmpi = 0;
    if (GPMF_OK == GPMF_ScaledData(sub, &tmpi, sizeof(tmpi), 0, 1, GPMF_TYPE_SIGNED_LONG))
    {
        rate_out = static_cast<double>(tmpi);
        return true;
    }

    return false;
}

// ------------------------------------------------------------
// Extract GPS5 (lat/lon/ele/...) samples as doubles
// ------------------------------------------------------------
static void extractGPS5(GPMF_stream *sub, double gpsu_epoch, double gpsf_rate, uint32_t counter, std::vector<GPSPoint> &gps_points)
{
    uint32_t samples = GPMF_PayloadSampleCount(sub);
    uint32_t elemsPerSample = GPMF_ElementsInStruct(sub);
    if (!samples || elemsPerSample < 3)
        return;

    // Try scaled doubles first (applies SCAL internally)
    std::vector<double> scaled(samples * elemsPerSample);
    GPMF_ERR res = GPMF_ScaledData(
        sub,
        scaled.data(),
        scaled.size() * sizeof(double),
        0,
        samples,
        GPMF_TYPE_DOUBLE);

    if (res == GPMF_OK)
    {
        // scaled[] should already be in the correct units (deg,deg,m,...)
        double interval = (gpsf_rate > 0.0) ? (1.0 / gpsf_rate) : 0.0;
        for (uint32_t s = 0; s < samples; ++s)
        {
            double lat = scaled[s * elemsPerSample + 0];
            double lon = scaled[s * elemsPerSample + 1];
            double ele = scaled[s * elemsPerSample + 2];

            std::string iso_time;
            if (gpsu_epoch > 0.0 && interval > 0.0)
            {
                double tsec = gpsu_epoch + (double)s * interval;
                iso_time = format_iso_from_epoch(tsec);
            }
            // --- GPS altitude validity filter ---
            // Early GPS5 samples often report a static bogus altitude (~1902 m) before GPS lock.
            // Wait until elevation starts changing, then record points normally.
            static double last_ele = 0;
            if (counter == 0)
                last_ele = ele;
            static bool gps_valid = false;

            if (!gps_valid)
            {
                // Detect when altitude begins varying (GPS lock acquired)
                if (std::fabs(ele - last_ele) > 1.0)
                {
                    gps_valid = true;
                    std::cerr << "[DEBUG] GPS lock detected at sample " << s
                              << " (alt=" << ele << ")\n";
                }
                else
                {
                    last_ele = ele;
                    continue; // skip early invalid samples
                }
            }

            // Store valid sample after GPS lock
            gps_points.push_back({lat, lon, ele, iso_time});
        }
    }
    else
    {
        // fallback: read raw signed longs and apply SCAL if we have them
        std::cerr << "[WARN] GPMF_ScaledData failed for GPS5, trying raw + SCAL fallback (err=" << res << ")\n";
        std::vector<int32_t> raw(samples * elemsPerSample);
        if (GPMF_OK == GPMF_ScaledData(sub, raw.data(), raw.size() * sizeof(int32_t), 0, samples, GPMF_TYPE_SIGNED_LONG))
        {
            for (uint32_t s = 0; s < samples; ++s)
            {
                double lat = raw[s * elemsPerSample + 0];
                double lon = raw[s * elemsPerSample + 1];
                double ele = raw[s * elemsPerSample + 2];

                lat /= 1e7;
                lon /= 1e7;

                std::string iso_time;
                if (gpsu_epoch > 0.0 && gpsf_rate > 0.0)
                {
                    double tsec = gpsu_epoch + (double)s * (1.0 / gpsf_rate);
                    iso_time = format_iso_from_epoch(tsec);
                }

                gps_points.push_back({lat, lon, ele, iso_time});
            }
        }
        else
        {
            std::cerr << "[ERROR] Could not read GPS5 raw data either\n";
        }
    }
}

// ------------------------------------------------------------
// Helper: convert ISO8601 string (e.g. "2025-10-12T08:39:34Z") → epoch seconds
// ------------------------------------------------------------
double isoToEpoch(const std::string &iso)
{
    if (iso.empty())
        return 0.0;

    std::tm tm = {};
    std::istringstream ss(iso);
    ss >> std::get_time(&tm, "%Y-%m-%dT%H:%M:%S");
    if (ss.fail())
    {
        std::cerr << "[WARN] Failed to parse ISO time: " << iso << std::endl;
        return 0.0;
    }

#if defined(_WIN32)
    return static_cast<double>(_mkgmtime(&tm));
#else
    return static_cast<double>(timegm(&tm));
#endif
}