#pragma once
#include <vector>
#include <string>
#include "GPMFExtractor.h"

// Combines telemetry and timing from multiple GPMFResult objects
class GPMFCombiner
{
public:
    // Merge all results in chronological order (by creation_time_iso)
    GPMFResult combineResults(const std::vector<GPMFResult> &results);
};