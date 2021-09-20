---
layout: post
title: "SDL2 Internals: Windowing Subsystem (Part I)"
description: "A high level overview of the SDL Video subsystem and window
creation API, and how it delegates to platform specific library code."
tags: [sdl2, gamedev, graphics, c]
comments: true
---

In my [previous post]({{ post.previous.url }}) I wrote about how the SDL2
library uses cool preprocessor tricks to slot itself between the C runtime and
the `main` function to allow allow software to run on a wide variety of
platforms using only a single entry point. The SDL2 library abstracts away many
other quirks of cross-platform development, however I've recently been exploring
how the library handles creation of windows across the many potential windowing
APIs.  

## SDL2's Windowing API

The process to create a window varies wildly across the many different platform
and in some cases across the many inter-platform windowing APIs. SDL2 reduces
this complexity down to just a few lines: 

```c
/* conditionally includes necessary headers across all supported platorms */
#include <SDL2/SDL.h>

int main()
{
    // Error handling omitted for brevity
    SDL_VideoInit(NULL);
    SDL_Window *window = SDL_CreateWindow(
         "My Window Title",
         0, 0,                  // x y coords of window
         1600, 900,             // width and height
         SDL_WINDOW_RESIZABLE); // window flags
}
```

The `SDL_VideoInit` function is responsible for establishing a connection to the
underlying platform's window manager and figuring out the pixel formats and
display modes that are available. It can take an optional driver name to load
(e.g.  `x11`, `wayland`, `windows` etc.) or `NULL` to have SDL2 figure out the
which windowing API to use for us. As you would expect, the `SDL_CreateWindow`
creates and shows a window for us to interact with.

`SDL_VideoInit`
---------------

For each of the windowing APIs that SDL2 supports, it provides an instance of a
`VideoBootstrap` struct as defined in
[SDL_sysvideo.h](https://github.com/SDL-mirror/SDL/blob/master/src/video/SDL_sysvideo.h#L361):

```c
typedef struct VideoBootStrap
{
    const char *name;
    const char *desc;
    int (*available) (void);
    SDL_VideoDevice *(*create) (int devindex);
} VideoBootStrap;
```

The `name` is compared with the parameter to `SDL_VideoInit` if provided, but is
otherwise uninteresting. The `available` function pointer points to a function
that ascertains whether the windowing library exists on the system, while the
function pointed to by `create` will do the initialisation outlined above. 

`SDL_VideoInit`
[loops](https://github.com/SDL-mirror/SDL/blob/master/src/video/SDL_video.c#L478)
through an array of `VideoBootstrap` instances, checking it's name if required,
and attempting to create it if it is available. The content of the array is
determined for each platform when the library is compiled using `#if`
pre-processor guards as shown below. For exmaple, Win32 platforms will likely
just contain the Windows bootstrap, where as if the library was compiled for
Linux it would include the classic [X11](https://www.x.org/wiki/) library, the
more modern [Wayland](https://wayland.freedesktop.org/) and, in some cases,
Ubuntu's [Mir](https://wiki.ubuntu.com/Mir).

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

I have omitted a number of esoteric drivers in the interest of space, but the
full list can be seen in
[SDL_video.c](https://github.com/SDL-mirror/SDL/blob/master/src/video/SDL_video.c#L63).
The function pointed-to by `create` returns a pointer to a
[`VideoDevice`](https://github.com/SDL-mirror/SDL/blob/master/src/video/SDL_sysvideo.h#L145)
struct.  The definition of this struct is much too large to list here but it
essentially contains wrappers around the underlying library's display primitives
and pointers to functions for creating and managing windows.

This pointer is stored in a static variable called `_this` in
[SDL_video.c](https://github.com/SDL-mirror/SDL/blob/master/src/video/SDL_video.c#L118)
and is used to delegate from the top-level SDL functions down to those which are
specific to the underlying API.

`SDL_CreateWindow`
------------------

With the video system intialised, we can create the window with the
`SDL_CreateWindow` function. This function takes a string as a title along with
position and dimensions of the window. The final argument is a set of flags to
customize the window decorations and capabilities. The function returns an
[`SDL_Window`](https://github.com/SDL-mirror/SDL/blob/master/src/video/SDL_sysvideo.h#L71)
struct that contains platform-agnostic window data and wraps the underlying
library's window data behind a `void` pointer.

Internally, `SDL_CreateWindow` allocates an `SDL_Window` on the heap, sets the
platform-agnostic data and adds it to the linked-list of window instances on
`VideoDevice`. It then passes the window into the `CreateFunction` pointer on
the video `VideoDevice` to do the library specific work to create the window.

A synopsis of the `SDL_CreateWindow`, as defined in
[SDL_video.c](https://github.com/SDL-mirror/SDL/blob/master/src/video/SDL_video.c#L1330),
is outlined below (comments mine):

```c
SDL_Window *
SDL_CreateWindow(const char *title, int x, int y, int w, int h, Uint32 flags)
{
    SDL_Window *window;
    
    /* error-checking on inputs and dealing with flags omitted */
    ...

    /* magic pointer used in other functions make sure the window belongs to the
     * VideoDevices bound to _this */
    window->magic = &_this->window_magic;
    window->id = _this->next_object_id++;
    window->x = x;
    window->y = y;
    window->w = w;
    window->h = h;

    /* Set more relatively boring visual parameters on the the window */
    ...

    /* Add window to linked list on _this */
    if (_this->windows) {
        _this->windows->prev = window;
    }
    _this->windows = window;

    /* Delegate to library-specific window creation through the _this pointer */
    if (_this->CreateWindow && _this->CreateWindow(_this, window) < 0) {
        SDL_DestroyWindow(window);
        return NULL;
    }

    /* Set title and finialize window creation before returning */
    ...

    return window
}
```

Assuming X11 was the lucky library to be bootstrapped, the `CreateWindow`
function pointer points to `X11_CreateWindow` inside
[x11/SDL_x11window.c](https://github.com/SDL-mirror/SDL/blob/master/src/video/x11/SDL_x11window.c#L360)
which has all of the X11-specific symbols to create an X11 Window.

The X11 window data is stored in a
[`SDL_WindowData`](https://github.com/SDL-mirror/SDL/blob/master/src/video/x11/SDL_x11window.h#L43)
struct that is defined for that particular library and is referenced by the
owning `SDL_Window` behind a `void`
[pointer](https://github.com/SDL-mirror/SDL/blob/master/src/video/SDL_sysvideo.h#L109)
as outlined above.  This pointer is cast back to the `SDL_WindowData` struct
inside the X11 specific window handling functions to get at the data required to
interact with the underlying API.  The specifics of creating a window using the
X11 API is out of the scope of this post (that's not to say I won't post about
it in the future), so that's where this part of the series ends.

Conclusion
----------

I've covered the basic high-level interface of the SDL2 window creation API and
how it initialises the video subsystem and delegates to platform-specific
windowing libraries through function pointers on the `VideoDevice` structure
that wraps the the underlying API.

For me it was interesting to see a very object-orientated approach used
internally within the SDL2 library. The of use data types to represent the
connection the video device/display server and windows, and encapsulating the
implementation details for the library-specific functions behind function
pointers gave me great insight on how I could approach writing my future
projects in C.  

You'll notice that I glossed over how SDL2 detects whether the library exists on
the system and how it gets access to the library symbols in the platform
specific code. This is a large topic that deserves its own post so I will cover
that in the next installment.

