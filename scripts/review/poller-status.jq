[.[] | select(.context == $lens)] | sort_by(.created_at, .id) | last | .state // ""
