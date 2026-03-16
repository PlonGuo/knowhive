---
title: Rerooting DP
category: Dynamic Programming
tags: [dynamic-programming, rerooting-dp, tree, dfs]
difficulty: null
pack_id: leetcode-basics
---

# Rerooting DP

## Core Idea

- A tree DP technique that uses two DFS passes
- First DFS: compute subtree information rooted at each node
- Second DFS: use a rerooting formula to compute the answer as if each node were the root
- Used to solve "for every node as root" type tree problems

## Key Properties

1. **Subtree DP** - compute subtree info for each node in the first pass
2. **Rerooting formula** - derive child-as-root info from parent-as-root info
3. **Direction handling** - distinguish "upward" and "downward" information flow

## Common Problem Types

### 1. Distance-Related

- Sum of distances from all nodes to all other nodes
- Maximum distance from each node to all others
- Weighted tree distance problems

### 2. Counting-Related

- Subtree size/weight sum when each node is root
- Statistical properties rooted at each node

### 3. Optimality-Related

- Optimal value when each node is the root
- Tree centroid related problems

## Code Template

```python
def dfs1(u, parent):
    """First DFS: compute subtree information"""
    subtree_size[u] = 1
    dp[u] = 0  # sum of distances within subtree rooted at u

    for v in graph[u]:
        if v == parent:
            continue
        dfs1(v, u)
        subtree_size[u] += subtree_size[v]
        dp[u] += dp[v] + subtree_size[v]  # accumulate subtree contribution

def dfs2(u, parent):
    """Second DFS: rerooting computation"""
    for v in graph[u]:
        if v == parent:
            continue

        # Rerooting formula: transition from u as root to v as root
        # 1. Subtract v's subtree contribution
        # 2. Add contribution from the rest of the tree via u
        ans[v] = ans[u] - subtree_size[v] + (n - subtree_size[v])

        dfs2(v, u)

# Main
n = len(graph)
subtree_size = [0] * n
dp = [0] * n
ans = [0] * n

dfs1(0, -1)
ans[0] = dp[0]  # result when node 0 is root
dfs2(0, -1)
```

## Related Problems

1. LC 834 - Sum of Distances in Tree (classic rerooting DP)
2. LC 310 - Minimum Height Trees (similar rerooting idea)
3. LC 1617 - Count Subtrees With Max Distance Between Cities (rerooting variant)

## Related Topics

- Dynamic Programming - parent topic
- Tree DP - general tree dynamic programming
- DFS - traversal foundation
- BFS - alternative tree traversal
