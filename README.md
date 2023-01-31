Semi-automatic logbook for Signal K
===================================

Status: just a sketch for now

This application provides both a server-side plugin and the user interface for maintaining semi-automatic logbooks with [Signal K](https://signalk.org). Just like traditional logbooks, you can write an entry at any time. However, there are several things that are done automatically for you:

* Entries written when starting/ending a trip (requires [signalk-autostate](https://github.com/meri-imperiumi/signalk-autostate) plugin)
* Entries written when turning the engine on or off (requires engine _on state_ or RPMs to be available to Signal K)
* Entries written when reefing or changing the sail plan (requires [sailsconfiguration](https://github.com/SignalK/sailsconfiguration) plugin)
* When underway, an entry is created every hour recording the current conditions

You can also create some additional rules for automated entries when certain things happen (for example, when turning on a watermaker).

## Data storage and format

This logbook app writes the logs to disk using [YAML format](https://en.wikipedia.org/wiki/YAML) which combines machine readability with at least some degree of human readability.

Logs are stored on a file per day basis at `~/.signalk/plugin-config-data/signalk-logbook/YYYY-MM-DD.yml`
If there are no entries for a given day, no file gets written.

It is a good idea to set up automatic backups of these files off the vessel, for example to [GitHub](https://github.com) or some other cloud storage service. How to handle this backup is out of the scope of this plugin.
