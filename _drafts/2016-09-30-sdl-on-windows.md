---
layout: post
title:  "How SDL2 does its initialisation magic on Windows"
comments: true
tags: [c, sdl2, systems-programming, windows]
---
[SDL](https://www.libsdl.org/) (or Simple DirectMedia Layer) is an oft-recommended library for cross-platform games development. It is a C library that supports many platforms and provides a simple API to access many parts of the hardware and platform-specific libraries that are required to develop game engines and other multimedia apps.

> Simple DirectMedia Layer is a cross-platform development library designed to provide low level access to audio, keyboard, mouse, joystick, and graphics hardware via OpenGL and Direct3D. It is used by video playback software, emulators, and popular games including Valve's award winning catalog and many Humble Bundle games. 
>
>  <div style="text-align: right; margin-right: 4rem;"> -- libsdl.org</div>

SDL is often billed as a way of easily making your Windows application run on different platforms, e.g. Linux, without having to jump through the many conflicting hoops that the different platform APIs require. Interestingly, on inspection of the code it seems that, at least initially, the majority of hoop-jumping is required on the Windows side of things, meaning SDL could potentially be better described as a way of easily porting your Linux apps to Windows.

The method by which SDL navigates these hoops involves interesting (ab)use of the C Pre-Processor to slot itself between the C runtime and your application code. This article aims to explain how SDL does this and why the result provides us with more utility than initially meets the eye.

Interestingly, many of the intricacies of the launch of an SDL application can be explored with the simplest of code:
```c
int main() {}
```

How `main` works
----------------

Before SDL gets involved it is worth briefly going over what happens when your executable is run. Whilst it is true that the `main` (or `WinMain`) function is the entry point into _your_ code it is not the first thing that is executed.
If we look at the call stack from the point of main we can see a number of other functions are run before our `main` function is executed.
```
> 	SDLmain.exe!main(...) Line 1	C
	SDLmain.exe!invoke_main() Line 64	C++
	SDLmain.exe!__scrt_common_main_seh() Line 253	C++
	SDLmain.exe!__scrt_common_main() Line 296	C++
	SDLmain.exe!mainCRTStartup() Line 17	C++
	kernel32.dll!752d62c4()	Unknown
```
The Windows kernel kicks of the C runtime and calls the `mainCRTStartup` function which sets up the environment for our executable. The `invoke_main()` function calls one of four user-defined entry point functions (`main`, `WinMain`, `wmain` or `wWinMain`). After all of this, the code in our `main` function will execute.

The setup code is added to our executable when we compile and the linker attempts to link one of the user-defined entry points depending on which subsystem we are targeting.

In this case, the `main` variant is called as we are currently targeting the 'Console' subsystem of the Windows platform. The second main type of user-definable entry point, `WinMain`, is invoked if the executable was built targeting the 'Windows' subsystem, which forgoes initialising the console to run purely as graphical Windows application. The `w` variants are the same as their non-`w` counterparts but the arguments are passed as Unicode characters (`wchar_t`).

For example, if we were to target the Windows subsystem with our code as it stands, we would get a linker error telling us that it was unable to find the `WinMain` symbol.

Getting SDL involved
--------------------

First off, let's build our simple example as Console application (i.e. targeting the Console subsystem).
```
1>------ Build started: Project: SDLmain, Configuration: Debug Win32 ------
1>  SDLmain.c
1>  SDLmain.vcxproj -> E:\src\SDLmain\Debug\SDLmain.exe
1>  SDLmain.vcxproj -> E:\src\SDLmain\Debug\SDLmain.pdb (Partial PDB)
========== Rebuild All: 1 succeeded, 0 failed, 0 skipped ==========
```
```
The program '[916] SDLmain.exe' has exited with code 0 (0x0).
```
Excellent! The code compiles and runs as expected. However, just including the SDL header gives a surprising result.
```c
#include <SDL.h>

int main() {}
```
```
Error	LNK2019	unresolved external symbol _main referenced in function "int __cdecl invoke_main(void)" (?invoke_main@@YAHXZ)	SDLmain	E:\src\SDLmain\SDLmain\MSVCRTD.lib(exe_main.obj)	1	
```
The linker can no longer find our `main` function. A quick glance at the [SDL.h](https://hg.libsdl.org/SDL/file/ac1c949c14b4/include/SDL.h) header we find another header file, [SDL_main.h](https://hg.libsdl.org/SDL/file/ac1c949c14b4/include/SDL_main.h), that gives some insight as to whats going on.
```c
/* Line 32 */
#ifndef SDL_MAIN_HANDLED
#if defined(__WIN32__)
/* On Windows SDL provides WinMain(), which parses the command line and passes
   the arguments to your main function.

   If you provide your own WinMain(), you may define SDL_MAIN_HANDLED
 */
#define SDL_MAIN_AVAILABLE
```
```c
/* Line 102 */
#if defined(SDL_MAIN_NEEDED) || defined(SDL_MAIN_AVAILABLE)
#define main    SDL_main
#endif

/**
 *  The prototype for the application's main() function
 */
extern C_LINKAGE int SDL_main(int argc, char *argv[]);
```
After detecting that we are compiling on Windows, the `SDL_main` header redefines the `main` symbol to `SDL_main` and declares a prototype for that function for the linker to sort out later. So as a result of including SDL.h, our `main` function has been renamed, which explains why the linker is complaining that it cannot find it.

The comments suggest that SDL provides the entry point definition for us, so we should probably let the linker know where the SDL symbols are located. Adding `SDL2.lib` and `SDL2main.lib` as dependencies and providing the executable with the `.dll`, we compile and run as expected once more. Looking again at the call stack from the point of our `main` function we can see few extra function calls have been added.
```
>	SDLmain.exe!SDL_main(...) Line 3	C
 	SDLmain.exe!main_utf8() Line 126	C
 	SDLmain.exe!main() Line 134	C
 	SDLmain.exe!invoke_main() Line 64	C++
 	SDLmain.exe!__scrt_common_main_seh() Line 253	C++
 	SDLmain.exe!__scrt_common_main() Line 296	C++
 	SDLmain.exe!mainCRTStartup() Line 17	C++
 	kernel32.dll!752d62c4()	Unknown
```
The `main` and `main_utf8` shown here are provided by the SDL library. We can also see our `main` function sporting its new `SDL_main` moniker. The definitions for the SDL main functions can be found in [SDL_windows_main.c](http://hg.libsdl.org/SDL/file/7fde2d881171/src/main/windows/SDL_windows_main.c).

```c
/* Line 7 */
#ifdef __WIN32__
```
```c
/* Line 17 */
#ifdef main
#   undef main
#endif /* main */
```
```c
/* Line 110 */
#if defined(_MSC_VER)
/* The VC++ compiler needs main/wmain defined */
# define console_ansi_main main
# if UNICODE
#  define console_wmain wmain
# endif
#endif

/* WinMain, main, and wmain eventually call into here. */
static int
main_utf8(int argc, char *argv[])
{
    SDL_SetMainReady();

    /* Run the application main() code */
    return SDL_main(argc, argv);
}

/* This is where execution begins [console apps, ansi] */
int
console_ansi_main(int argc, char *argv[])
{
    /* !!! FIXME: are these in the system codepage? We need to convert to UTF-8. */
    return main_utf8(argc, argv);
}
```
```
/* Line 198 */
#endif /* __WIN32__ */
```

In the above compilation unit, SDL undefs the `main` symbol it provided in the header and `console_ansi_main` is defined as `main` which provides the linker with the much needed entry point into our program. The reason for hiding this behind a 
preprocessor define instead of naming the function `main` directly still eludes me but, as far as I can tell, the result is the same.

The `main_utf8` function calls `SDL_SetMainReady` to confirm that initialisation was successful before invoking our renamed `SDL_main` function.

Success! But what have we actually gained?

What about `WinMain`?
---------------------
Interestingly, if we change the linker target to the 'Windows' subsystem, our program compiles and executes correctly without any modifications to the code. Taking a look at the call stack once again we see a very similar output to before.
```
>	SDLmain.exe!SDL_main(...) Line 3	C
 	SDLmain.exe!main_utf8() Line 126	C
 	SDLmain.exe!WinMain() Line 189	C
 	SDLmain.exe!invoke_main() Line 99	C++
 	SDLmain.exe!__scrt_common_main_seh() Line 253	C++
 	SDLmain.exe!__scrt_common_main() Line 296	C++
 	SDLmain.exe!WinMainCRTStartup() Line 17	C++
```
Here the `WinMain` function, provided by SDL, grabs a handle to the command line to parse provided arguments and forwards them to our `SDL_main` function in the same manner as the previous example. What we've gained is the ability to target two different Windows subsystems using only one of the user-defined entry point functions. What's more, the entry point we do have to define is also the simpler and platform-neutral `main` signature rather than the much more complex and Windows-specific `WinMain`:
 
Consider:
```c
int main(int argc, char **argv);
```
<div style="text-align: center">vs.</div>
```c
int CALLBACK WinMain(
  _In_ HINSTANCE hInstance,
  _In_ HINSTANCE hPrevInstance,
  _In_ LPSTR     lpCmdLine,
  _In_ int       nCmdShow
);
```

How does this differ to Linux?
------------------------------
SDL initialisation on Linux is significantly less exciting than it is on Windows. Given the only entry point supported in user-land Linux executables is the standard `int main(int argc, char **argv)`, SDL doesn't bother with any of the preprocessor magic and lets the initialisation code call our `main` function directly. This also means there is no `SDL_main` library to link to on Linux, just a single `-lSDL2` flag. Nice!

That's it. A little anti-climactic, I suppose. Though it does kind of embody the Zen of programming on Linux.

Conclusion
----------
I've only only scratched the surface of the SDL library in this post. Literally. We've not even got past the invocation of `main`! However, even with such a small amount of example code we've seen how SDL employs interesting preprocessor tricks to make cross-platform development simpler for the programmer, potentially without them even knowing about it.

As primarily a Linux programmer, I've learnt a few of the eccentricities of the Win32 API throughout this and look forward to exploring more of the differences between the two platforms in the future and how SDL tries to abstract these concepts away to make the programmer's life easier.

