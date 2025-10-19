cmake_minimum_required(VERSION 3.15)
project(gpmf_dump)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# -------------------------------------------------------------------
# Include directories
# -------------------------------------------------------------------
# Tell the compiler where to find your headers
include_directories(${PROJECT_SOURCE_DIR}/include)
include_directories(${PROJECT_SOURCE_DIR}/gpmf-parser)  # adjust if your GPMF headers live here
include_directories(${PROJECT_SOURCE_DIR}/gpmf-parser/nlohmann)  # adjust if your GPMF headers live here

# -------------------------------------------------------------------
# Source files
# -------------------------------------------------------------------
set(SOURCES
    main.cpp
    gpmf-parser/GPMF_parser.c
    gpmf-parser/GPMF_utils.c
    gpmf-parser/demo/GPMF_mp4reader.c

)

# -------------------------------------------------------------------
# Add the executable
# -------------------------------------------------------------------
add_executable(gpmf_dump ${SOURCES})

# -------------------------------------------------------------------
# Link against the gpmf-parser static library (if you build it separately)
# -------------------------------------------------------------------
# Example (uncomment if applicable):
# target_link_libraries(gpmf_dump PRIVATE gpmf-parser)

# -------------------------------------------------------------------
# Output directory (optional)
# -------------------------------------------------------------------
set_target_properties(gpmf_dump PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${PROJECT_SOURCE_DIR}/bin
)
add_definitions(-D_CRT_SECURE_NO_WARNINGS)