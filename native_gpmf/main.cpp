// main.cpp - GPMF -> meta + gpx + trimmed mp4 (warp_end arg is video-side seconds to keep)
#include <iostream>
#include <fstream>
#include <vector>
#include <array>
#include <string>
#include <filesystem>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <ctime>
#include <iomanip>
#include <algorithm>
#include <nlohmann/json.hpp>

#include "GPMF_common.h"
#include "GPMF_parser.h"
#include "GPMF_mp4reader.h"
#include "GPMF_utils.h"

using json = nlohmann::json;
namespace fs = std::filesystem;

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

static std::string format_iso_from_epoch(double epoch_seconds)
{
    time_t sec = static_cast<time_t>(std::floor(epoch_seconds));
    int msec = static_cast<int>(std::round((epoch_seconds - (double)sec) * 1000.0));
    if (msec >= 1000)
    {
        sec += 1;
        msec = 0;
    }

    struct tm gm{};
#if defined(_WIN32)
    gmtime_s(&gm, &sec);
#else
    gmtime_r(&sec, &gm);
#endif
    char buf[64];
    // include milliseconds
    std::snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
                  gm.tm_year + 1900, gm.tm_mon + 1, gm.tm_mday,
                  gm.tm_hour, gm.tm_min, gm.tm_sec, msec);
    return std::string(buf);
}

struct GPSPoint
{
    double lat;
    double lon;
    double ele;
    std::string iso_time;
};

// Read creation time from moov->mvhd (as UTC)
static std::string GetMP4CreationTimeISO(const std::string &filename)
{
    std::ifstream f(filename, std::ios::binary);
    if (!f.is_open())
        return "";

    while (true)
    {
        uint32_t sizeBE = 0, typeBE = 0;
        f.read(reinterpret_cast<char *>(&sizeBE), 4);
        f.read(reinterpret_cast<char *>(&typeBE), 4);
        if (!f)
            break;
        uint32_t size = _byteswap_ulong(sizeBE);
        uint32_t type = _byteswap_ulong(typeBE);
        if (size < 8)
            break;
        std::streampos atomEnd = f.tellg();
        atomEnd += static_cast<std::streamoff>(size - 8);

        if (type == STR2FOURCC("moov"))
        {
            while (f.tellg() < atomEnd)
            {
                uint32_t subSizeBE = 0, subTypeBE = 0;
                f.read(reinterpret_cast<char *>(&subSizeBE), 4);
                f.read(reinterpret_cast<char *>(&subTypeBE), 4);
                if (!f)
                    break;
                uint32_t subSize = _byteswap_ulong(subSizeBE);
                uint32_t subType = _byteswap_ulong(subTypeBE);
                if (subSize < 8)
                    break;
                std::streampos subAtomEnd = f.tellg();
                subAtomEnd += static_cast<std::streamoff>(subSize - 8);

                if (subType == STR2FOURCC("mvhd"))
                {
                    f.seekg(4, std::ios::cur); // skip version+flags
                    uint32_t creationBE = 0;
                    if (!f.read(reinterpret_cast<char *>(&creationBE), 4))
                        break;
                    uint32_t creation = _byteswap_ulong(creationBE);
                    const uint32_t mac_to_unix = 2082844800U;
                    if (creation < mac_to_unix)
                        return "";
                    time_t unix_time = creation - mac_to_unix;
                    struct tm gmt{};
#if defined(_WIN32)
                    gmtime_s(&gmt, &unix_time);
#else
                    gmtime_r(&unix_time, &gmt);
#endif
                    char buf[64];
                    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &gmt);
                    return std::string(buf);
                }
                f.seekg(subAtomEnd);
            }
        }
        f.seekg(atomEnd);
    }
    return "";
}

int main(int argc, char **argv)
{
    if (argc < 2)
    {
        std::cerr << "Usage: gpmf_dump <file.mp4> [warp_end_video_seconds]\n";
        return 1;
    }

    const std::string filename = argv[1];
    // warp_end_video_seconds = how long the *trimmed video* should be (video-side seconds).
    // If omitted or <= 0, no trimming will be done (keep entire video).
    double warp_end_video_arg = -1.0; // default = no trimming
    if (argc >= 3)
    {
        warp_end_video_arg = atof(argv[2]);
        if (warp_end_video_arg <= 0.0)
            warp_end_video_arg = -1.0;
    }
    constexpr double speed_factor = 10.0; // your fixed TimeWarp factor

    const std::string basename = fs::path(filename).stem().string();
    fs::create_directories("data");

    std::cout << "[INFO] Opening " << filename << std::endl;

    size_t mp4 = OpenMP4Source((char *)filename.c_str(), MOV_GPMF_TRAK_TYPE, MOV_GPMF_TRAK_SUBTYPE, 0);
    if (!mp4)
    {
        std::cerr << "[ERROR] OpenMP4Source failed\n";
        return 1;
    }

    uint32_t fr_numer = 0, fr_denom = 0;
    uint32_t frame_count = GetVideoFrameRateAndCount(mp4, &fr_numer, &fr_denom);
    double fps = fr_denom ? (double)fr_numer / (double)fr_denom : 0.0;

    size_t resHandle = GetPayloadResource(mp4, 0, 0);
    if (!resHandle)
        std::cerr << "[WARN] GetPayloadResource returned null; continuing\n";
    uint32_t payloadCount = GetNumberPayloads(mp4);
    std::cout << "[INFO] frames=" << frame_count << ", fps=" << fps << ", payloads=" << payloadCount << std::endl;

    std::vector<double> pts_times;
    pts_times.reserve(payloadCount);
    std::vector<double> gpsu_epochs;
    std::vector<GPSPoint> gps_points;
    std::vector<double> gps_speeds;
    std::string first_gpsu_iso;

    double last_payload_out = 0.0;
    uint32_t debugCounter = 0;

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

        // For each payload
        GPMF_stream gs;
        if (GPMF_OK == GPMF_Init(&gs, payload, payloadSize))
        {
            GPMF_ResetState(&gs);
            if (GPMF_OK == GPMF_FindNext(&gs, STR2FOURCC("STRM"), GPMF_RECURSE_LEVELS))
            {
                GPMF_stream sub;
                if (GPMF_OK == GPMF_CopyState(&gs, &sub))
                {
                    double gpsf_rate = 0.0;
                    time_t gpsu_epoch = 0;
                    std::string gpsu_iso;

                    // --- GPSU (UTC timestamp) ---
                    if (GPMF_OK == GPMF_FindNext(&sub, STR2FOURCC("GPSU"), GPMF_RECURSE_LEVELS))
                    {
                        char tsbuf[64] = {0};
                        bool got_ts = false;

                        // try UTC_DATE_TIME first
                        if (GPMF_OK == GPMF_ScaledData(&sub, tsbuf, sizeof(tsbuf) - 1, 0, 1, GPMF_TYPE_UTC_DATE_TIME))
                            got_ts = true;
                        else if (GPMF_OK == GPMF_ScaledData(&sub, tsbuf, sizeof(tsbuf) - 1, 0, 1, GPMF_TYPE_STRING_ASCII))
                            got_ts = true;

                        if (got_ts)
                        {
                            double epoch = 0.0;
                            if (parse_gpsu_to_epoch(tsbuf, epoch))
                            {
                                gpsu_epochs.push_back(epoch);
                                gpsu_epoch = epoch; // <-- assign latest GPSU time here!

                                if (first_gpsu_iso.empty())
                                    first_gpsu_iso = format_iso_from_epoch(epoch);
                            }
                        }
                    }

                    // --- GPSF: sampling rate in Hz ---
                    if (GPMF_OK == GPMF_FindNext(&sub, STR2FOURCC("GPSF"), GPMF_RECURSE_LEVELS))
                    {
                        double tmp = 0.0;

                        // Read GPSF as double if possible
                        if (GPMF_OK == GPMF_ScaledData(&sub, &tmp, sizeof(double), 0, 1, GPMF_TYPE_DOUBLE))
                        {
                            gpsf_rate = tmp;
                        }
                        else
                        {
                            // Try integer fallback
                            int32_t tmp_int = 0;
                            if (GPMF_OK == GPMF_ScaledData(&sub, &tmp_int, sizeof(int32_t), 0, 1, GPMF_TYPE_SIGNED_LONG))
                                gpsf_rate = (double)tmp_int;
                        }
                    }

                    // Fallback if GPSF not found or zero — GoPro GPS5 is usually 18Hz
                    if (gpsf_rate <= 0.0)
                    {
                        if (gpsu_epochs.size() >= 2)
                        {
                            // Estimate sampling rate based on total GPS5 samples / total elapsed GPS time
                            double total_time = gpsu_epochs.back() - gpsu_epochs.front();
                            double total_samples = gps_points.size();
                            if (total_time > 0.0 && total_samples > 0.0)
                            {
                                gpsf_rate = total_samples / total_time;
                                std::cerr << "[INFO] Estimated GPSF sampling rate: " << gpsf_rate << " Hz\n";
                            }
                        }
                        else
                        {
                            gpsf_rate = 18.0; // typical for GoPro GPS streams
                            std::cerr << "[WARN] GPSF not found or zero, using default rate of 18Hz\n";
                        }
                    }

                    // --- GPS5 (Lat, Lon, Alt, Speed2D, Speed3D) ---
                    if (GPMF_OK == GPMF_FindNext(&sub, STR2FOURCC("GPS5"), GPMF_RECURSE_LEVELS))
                    {
                        uint32_t samples = GPMF_PayloadSampleCount(&sub);
                        uint32_t elemsPerSample = GPMF_ElementsInStruct(&sub);

                        if (samples && elemsPerSample >= 3)
                        {
                            uint32_t samples = GPMF_PayloadSampleCount(&sub);
                            uint32_t elemsPerSample = GPMF_ElementsInStruct(&sub);
                            GPMF_SampleType type = GPMF_Type(&sub);
                            uint32_t datasize = GPMF_StructSize(&sub) * samples;

                            std::vector<uint8_t> raw_bytes(datasize);
                            if (GPMF_OK == GPMF_FormattedData(&sub, raw_bytes.data(), datasize, 0, samples))
                            {
                                const int32_t *raw_ints = reinterpret_cast<const int32_t *>(raw_bytes.data());
                                for (uint32_t s = 0; s < samples; ++s)
                                {
                                    int32_t raw_lat = raw_ints[s * elemsPerSample + 0];
                                    int32_t raw_lon = raw_ints[s * elemsPerSample + 1];
                                    int32_t raw_ele = raw_ints[s * elemsPerSample + 2];
                                }
                            }
                            else
                            {
                                std::cerr << "[ERROR] GPMF_FormattedData failed for GPS5\n";
                            }

                            // Try scaled doubles first (applies SCAL internally)
                            std::vector<double> scaled(samples * elemsPerSample);
                            GPMF_ERR res = GPMF_ScaledData(
                                &sub,
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
                                    if (i == 0)
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
                                if (GPMF_OK == GPMF_ScaledData(&sub, raw.data(), raw.size() * sizeof(int32_t), 0, samples, GPMF_TYPE_SIGNED_LONG))
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
                    }
                }
            }
        }
    }
    if (resHandle)
        FreePayloadResource(mp4, resHandle);
    CloseSource(mp4);

    // creation_time: prefer first GPSU (with ms) if present, else mvhd
    std::string creation_time_iso = GetMP4CreationTimeISO(filename);
    if (!gpsu_epochs.empty())
    {
        creation_time_iso = format_iso_from_epoch(gpsu_epochs.front());
    }

    // --- Decide trimming behavior and duration relationships ---
    double warp_end_video = 0.0; // seconds of *video* timeline to keep
    double warp_end_real = 0.0;  // real-world seconds represented in that clip

    // If GPSU timestamps exist, compute actual real-time span
    if (gpsu_epochs.size() >= 2)
    {
        warp_end_real = gpsu_epochs.back() - gpsu_epochs.front();
        std::cout << "[INFO] GPSU span first=" << format_iso_from_epoch(gpsu_epochs.front())
                  << " last=" << format_iso_from_epoch(gpsu_epochs.back())
                  << " span=" << warp_end_real << " s\n";
    }
    else
    {
        // Fallback: use payload timing if no GPSU data
        warp_end_real = last_payload_out * speed_factor;
        std::cout << "[WARN] No GPSU timestamps; falling back to payload span ("
                  << warp_end_real << " s real)\n";
    }

    // Determine how long to keep in the *video* output.
    //  - If user provided warp_end_video_arg > 0, that means: “trim to that many video seconds”
    //  - Otherwise, infer from GPSU span (real) divided by the known TimeWarp factor.
    if (warp_end_video_arg > 0.0)
    {
        warp_end_video = warp_end_video_arg;
        // derive equivalent real-time span for metadata
        warp_end_real = warp_end_video * speed_factor;
    }
    else
    {
        warp_end_video = warp_end_real / speed_factor;
    }

    // Filter PTS list to the kept (video-side) range
    std::vector<double> pts_kept;
    for (double t : pts_times)
    {
        if (warp_end_video_arg > 0.0 && t > warp_end_video)
            break; // user-trim cutoff
        pts_kept.push_back(t);
    }

    // Update frame_count accordingly
    frame_count = static_cast<uint32_t>(pts_kept.size());

    // Compute corrected pts (we removed real-time tail entirely)
    std::vector<double> pts_corrected;
    pts_corrected.reserve(pts_kept.size());
    for (double t : pts_kept)
        pts_corrected.push_back(t * speed_factor);

    // Write meta JSON
    json meta;
    meta["creation_time"] = creation_time_iso;
    meta["frame_count"] = frame_count;
    meta["frame_rate"] = fps;
    meta["warp_end_time"] = warp_end_real;
    meta["speed_factor"] = speed_factor;
    meta["pts_times"] = pts_corrected;

    std::string metaPath = "data/" + basename + "_gpmf_meta.json";
    std::ofstream(metaPath) << std::setw(2) << meta;

    // Trim MP4 if requested (use video-side seconds)
    std::string trimmed = "data/" + basename + "_gpmf.mp4";
    if (warp_end_video_arg > 0.0)
    {
        char cmd[1024];
        std::snprintf(cmd, sizeof(cmd), "ffmpeg -y -i \"%s\" -t %.6f -c copy \"%s\"", filename.c_str(), warp_end_video, trimmed.c_str());
        std::system(cmd);
    }

    // Write GPX (positions — not time-matched)
    std::string gpxPath = "data/" + basename + "_gpmf_gps.gpx";
    std::ofstream gpx(gpxPath);
    gpx << "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
    gpx << "<gpx xmlns=\"http://www.topografix.com/GPX/1/1\" version=\"1.1\" creator=\"gpmf_dump\">\n";
    gpx << "  <trk>\n    <name>" << basename << "</name>\n    <trkseg>\n";
    gpx << std::fixed; // use fixed-point notation
    for (const auto &pt : gps_points)
    {
        // lat/lon 7 decimals, ele 3 decimals
        gpx << "  <trkpt lat=\"" << std::setprecision(7) << pt.lat
            << "\" lon=\"" << std::setprecision(7) << pt.lon << "\">\n";
        gpx << "    <ele>" << std::setprecision(3) << pt.ele << "</ele>\n";
        if (!pt.iso_time.empty())
            gpx << "    <time>" << pt.iso_time.c_str() << "</time>\n";
        gpx << "  </trkpt>\n";
    }
    gpx << std::defaultfloat; // restore default if needed later

    gpx << "    </trkseg>\n  </trk>\n</gpx>\n";

    std::cout << "[OK] Wrote " << metaPath << " and " << gpxPath
              << " (trimmed video length: " << warp_end_video << " s, real seconds: " << warp_end_real << ")\n";

    return 0;
}
