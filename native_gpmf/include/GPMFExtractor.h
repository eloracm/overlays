#pragma once
#include <string>
#include <vector>

struct GPSPoint
{
    double lat;
    double lon;
    double ele;
    std::string iso_time;
};

struct GPMFResult
{
    std::vector<double> pts_times;   // warped presentation timestamps (seconds)
    std::vector<double> gpsu_epochs; // GPSU times in epoch seconds
    std::vector<GPSPoint> gps_points;
    double fps = 0.0;
    std::string creation_time_iso;
    uint32_t speed_factor;
    double startMs;
    double endMs;
    std::string source_filename;
};

GPMFResult extractGPMFData(const std::string &filename);
double isoToEpoch(const std::string &iso);