STATUS: DONE
- Pine Hollow is now darker and denser, as asked. Every pine carries more branch rings and more branches per ring, with far fewer gaps, plus a larger dark heart of needles. The crowns read as heavy black masses against the night sky, and the woods close in around the trails.
- Only one tree in twelve is now a sparse old tree (was two), and the forest's greens run darker overall, from deep near-black to mid green. The variety of shapes (tall firs, broad pines, wind-swept, broken and forked tops) is kept, so it's still not copy-paste.
- Tree positions, paths and collisions are unchanged.
- To see it: `npm run dev`, open `?map=forest`, and walk any trail at night. Before and after from the same spots are in `.ballast/media/mmwwovwqn/` ("before" = the previous trees, "dense" = now); `02-creek-trail-treeline` and `04-dense-stand-flashlight` show it best.
- Cost: about 30% more geometry for the trees (2.8M vs 2.1M triangles per frame in the forest without the torch). Expected to be fine on a desktop GPU; real frame rate couldn't be measured here. The lighting checks pass. One forest check (Bigfoot pathing round the ridge) fails on main without this change too.
- PR: PR_LINK
