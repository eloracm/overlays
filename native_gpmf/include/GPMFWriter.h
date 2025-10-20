#pragma once
#include "GPMFExtractor.h"
#include <string>

void writeMetaJson(const GPMFResult &result, const std::string &outPath);
void writeGPX(const GPMFResult &result, const std::string &outPath);
