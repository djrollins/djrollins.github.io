---
layout: post
title: "How SDL2 dynamically loads windowing libraries (Part 1)"
description: ""
tags: [sdl2, gamedev, linux, shared-libraries, linker]
---

In my previous post I wrote about how the SDL2 library uses cool preprocessor
tricks to slot itself between the C runtime and the `main` function to allow
allow software to run on a wide variety of platforms using only a single entry
point. The SDL2 library abstracts away many other quirks of cross-platform
development, however I've recently been exploring how the library handles
creation of windows across the many potential windowing APIs.

## SDL2's Windowing API

The process to create a window varies wildly across the many different platform
APIs and in some cases across the many inter-platform windowing APIs. SDL2
reduces this complexity down to just a few lines:

```c
// conditionally includes all necessary headers across all supported platorms
#include <SDL2/SDL.h>

int main()
{
    // Error handling omitted for brevity
    SDL_VideoInit(NULL);
    SDL_Window *window = SDL_CreateWindow(
         "My Window Title",
         0, 0,          // x y coords of window
         1600, 900);    // width and height
}
```

The `SDL_VideoInit` function takes a driver name for if we wanted to use a
specific API e.g. `"x11"` for X11 on Linux or `"windows"` for Windows. The
function loops through an array of `VideoBootstrap` `struct`s and attempts to
load the specified driver. If the driver is `NULL` the function attempts load
each of the drivers in the array until one of them succeeds.

The `VideoBootstrap` structure is defined in `SDL_sysvideo.h` as:

```c
typedef struct VideoBootStrap
{
    const char *name;
    const char *desc;
    int (*available) (void);
    SDL_VideoDevice *(*create) (int devindex);
} VideoBootStrap;
```

`name` is what is compared to the driver name above and `desc` is a
user-readable description that is never really used.

The structure also contains two function pointers. These functions are
responsible for detecting the availability of the library and the loading of the
symbols if it exists. 

The `available` function returns whether the library exists on the system, as
you would expect. The `create` function loads the library symbols and returns an
`SDL_VideoDevice` that that contains platform-agnostic wrappers for the native
windowing primitives and functions. The definition of `SDL_VideoDevice` is too
long to list but it is also defined in the `SDL_sysvideo.h` header. It basically
contains a bunch of function pointers to platform specific code for initializing
the library and creating and handling windows.

The `VideoBootstrap` array is populated at compile time with platform specific
instances, guarded by preprocessor `#if`s. SDL2 defines which drivers are
available in platform-specific configuration headers.

```c
/* Available video drivers */
static VideoBootStrap *bootstrap[] = {
#if SDL_VIDEO_DRIVER_COCOA
    &COCOA_bootstrap,
#endif
#if SDL_VIDEO_DRIVER_X11
    &X11_bootstrap,
#endif
#if SDL_VIDEO_DRIVER_MIR
    &MIR_bootstrap,
#endif
#if SDL_VIDEO_DRIVER_WAYLAND
    &Wayland_bootstrap,
#endif
/* a few esteric drivers omitted */
#if SDL_VIDEO_DRIVER_WINDOWS
    &WINDOWS_bootstrap,
#endif
/* lots more esoteric drivers omitted */
    NULL
};
```

I have omitted a number of esoteric drivers as there are many in the actual
code. However you can get an idea of how this array would differ if
compiled on Windows compared to Linux. 

Why does the SDL2 library have go through all of this rigmarole? Well in order
for a program to be cross-platform, it needs to not only play nice with the
libraries available to each platform but it also needs to not rely on on things
that are not available. For completely separate platforms, e.g. Windows and
Linux, it's fairly trivial to exclude Linux-specific code from a Windows build
and _vice versa_, but what what about intra-platform differences and conflicts?  

With regards to windowing APIs, SDL2 may be able to dynamically link to the
Windows windowing library indiscriminately as that is the only one available on
that platform. However, in the Linux world, the user has a number of options for
which window manager they wish to use, for example X11, Wayland and Mir are all
supported by SDL2.

## Static Linking vs Dynamic Linking vs Dynamic Loading

Before going any further it is worth briefly going over the difference between
static linking, dynamic linking and dynamic loading.

When compiling a program that relies on an external library, the resulting
object file does not automatically contain the definitions of the functions and
symbols directly. The role of the linker is to fill in the gaps and provide the
definitions for us. Linking can be achieved either statically or dynamically.

##### Static linking

If we ask the linker to link statically, it will essentially concatenate our
object file with a library's statically compiled object file and turn that into
an executable binary. Our executable then contains all of the function
definitions and symbols directly, meaning we do not have a runtime dependency on
the library. Whilst this allows our executable to run independently, it does
have a number of downsides.

By bundling the library into our executable we have increased the memory
footprint of our binary and any other executable using the same library will
have to load their own version. Additionally, if we needed to use a newer
version of the library (e.g. for a bug fix upstream) we would need to recompile
our program and link in the new version.  

##### Dynamic linking

Dynamic linking solves these issues by deferring the linking until our
executable is run. In this case it is up to the OS's dynamic linker to find the
missing symbols at run-time from a shared library. This solves the issue of
memory bloat as many different processes can share the same instance of the
library, and we get any bug-fixes/updates from the library for free.

The issue with this approach is that if the user does not have the dependency
installed on their machine, our executable will fail to load, with a
fairly ugly message about a missing shared library (or dll on Windows).

##### Dynamic Loading

Dynamic loading is the process of ignoring the linker all together and loading
the library ourselves at run time. In this case we define pointers to the
functions and symbols we want to use and populate them by calling into the
platform shared library loading facilities (`dlopen` on Linux or `LoadLibrary`
on Windows).

This does mean a large increase in complexity in our code, as we'll see later,
but we gain the flexibility to decided what to do if library doesn't exist on
the users computer. In the event that the library doesn't exist we could
fallback to different code or just present the user with a friendlier error
message.

Loading a library dynamically on Linux is a fairly simple process. As a
contrived example, loading the `int foo(char *)` symbol from the `bar` library
and using it could be achieved as follows:

```c
int foo_it_up(void)
{
    void *lib_handle;
    int (*foo)(char *);
    int ret;

    // Open a handle the bar library
    lib_handle = dlopen("libbar.so");
    if (!lib_handle) {
        // failed to load bar, report the error
        fprintf(stderr, "%s", dlerror());
        return 0;
    }

    // get the address of the foo function
    foo = dlsym(lib_handle, "foo");
    if (!foo) {
        // couldn't load foo
        fprintf(stderr, "%s", dlerror());
        dlclose(lib_handle);
        return 0;
    }

    ret = foo("doot");

    // close the the library
    dlclose(lib_handle);

    return ret;
}
```

##### What does SDL2 do?

Given vast number of dependencies SDL wraps, both static and dynamic linking are
problematic. Having SDL2 statically link to X11, Wayland and Mir would increase
the problems outlined about three-fold - and that's just the windowing
subsystem on a single platform! Likewise, SDL2 cannot expect the user to install
all three window management libraries, just to get SDL2 to load without error,
if they're only using one of them.

For these reasons SDL has to resort to dynamically loading one of the libraries
at run time. These libraries have a complex APIs with a lot of symbols and
functions that need to be loaded, meaning the process can be quiet repetitive
and cumbersome. This is where the aforementioned preprocessor tricks come in.

