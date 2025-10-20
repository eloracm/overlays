#include "GPMFExtractor.h"
#include "GPMFCombiner.h"
#include "GPMFWriter.h"
#include <filesystem>
#include <iostream>

namespace fs = std::filesystem;

int main(int argc, char **argv)
{
    if (argc < 2)
    {
        std::cerr << "Usage: gpmf_merge <file1.mp4> [file2.mp4 ...]\n";
        return 1;
    }

    std::vector<GPMFResult> results;
    for (int i = 1; i < argc; ++i)
        results.push_back(extractGPMFData(argv[i], 0, 114.0));

    GPMFResult combined = (results.size() > 1)
                              ? combineResults(results)
                              : results.front();

    std::string base = fs::path(argv[1]).stem().string();

    writeMetaJson(combined, base + "_combined_gpmf_meta.json");
    writeGpx(combined, base + "_combined_gpmf_gps.gpx");

    std::cout << "[DONE] Combined " << results.size() << " video(s)." << std::endl;
}
