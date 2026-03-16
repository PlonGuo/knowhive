---
title: Graph Theory Overview
category: Graph Theory
tags: [graph, bfs, dfs, dijkstra, shortest-path, minimum-spanning-tree]
difficulty: null
pack_id: leetcode-basics
---

# Graph Theory Overview

## Algorithm Classification

### 1. Unweighted Graph

| Algorithm | Graph Type | Purpose | Time | Space |
|-----------|-----------|---------|------|-------|
| BFS | Undirected/Directed | Shortest path (fewest edges) | O(V+E) | O(V) |
| DFS | Undirected/Directed | Traversal/Connectivity/Topological sort | O(V+E) | O(V) |

**Key difference**:
- BFS: uses queue, expands level by level, guarantees minimum edge count path
- DFS: uses stack/recursion, goes deep first, good for exploring all possible paths

### 2. Weighted Graph - Non-Negative Weights

| Algorithm | Graph Type | Purpose | Time | Space |
|-----------|-----------|---------|------|-------|
| Dijkstra | Directed/Undirected | Single-source shortest path | O((V+E)logV) | O(V) |

**Dijkstra core idea**: greedy algorithm selecting the node with smallest current distance; requires non-negative weights; uses priority queue (min-heap) for optimization.

### 3. Weighted Graph - Negative Weights Allowed

| Algorithm | Graph Type | Purpose | Time | Space |
|-----------|-----------|---------|------|-------|
| Bellman-Ford | Directed | Single-source shortest path, detect negative cycles | O(VE) | O(V) |
| Floyd-Warshall | Directed | All-pairs shortest path | O(V^3) | O(V^2) |

**Key difference**:
- Bellman-Ford: handles negative weights, detects negative cycles, good for sparse graphs
- Floyd-Warshall: computes all-pairs distances, good for dense graphs, concise code

### 4. Minimum Spanning Tree (MST) - Undirected Weighted Graph

| Algorithm | Graph Type | Purpose | Time | Space |
|-----------|-----------|---------|------|-------|
| Prim | Undirected weighted | MST (expand from nodes) | O((V+E)logV) | O(V) |
| Kruskal | Undirected weighted | MST (sort edges) | O(ElogE) | O(V) |

**Key difference**:
- Prim: similar to Dijkstra, starts from a node, good for dense graphs
- Kruskal: sorts edges, uses Union-Find, good for sparse graphs

## Code Templates

### BFS

```python
from collections import deque

def bfs(graph, start):
    visited = set([start])
    queue = deque([start])

    while queue:
        node = queue.popleft()

        for neighbor in graph[node]:
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)
```

### Dijkstra

```python
import heapq

def dijkstra(graph, start):
    n = len(graph)
    dist = [float('inf')] * n
    dist[start] = 0
    heap = [(0, start)]

    while heap:
        curr_dist, node = heapq.heappop(heap)

        if curr_dist > dist[node]:
            continue

        for neighbor, weight in graph[node]:
            new_dist = curr_dist + weight
            if new_dist < dist[neighbor]:
                dist[neighbor] = new_dist
                heapq.heappush(heap, (new_dist, neighbor))

    return dist
```

### Kruskal (Union-Find)

```python
class UnionFind:
    def __init__(self, n):
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x):
        if self.parent[x] != x:
            self.parent[x] = self.find(self.parent[x])
        return self.parent[x]

    def union(self, x, y):
        root_x, root_y = self.find(x), self.find(y)
        if root_x == root_y:
            return False
        if self.rank[root_x] < self.rank[root_y]:
            self.parent[root_x] = root_y
        elif self.rank[root_x] > self.rank[root_y]:
            self.parent[root_y] = root_x
        else:
            self.parent[root_y] = root_x
            self.rank[root_x] += 1
        return True

def kruskal(n, edges):
    edges.sort(key=lambda x: x[2])  # sort by weight
    uf = UnionFind(n)
    mst_weight = 0

    for u, v, weight in edges:
        if uf.union(u, v):
            mst_weight += weight

    return mst_weight
```

## Complexity Summary

| Algorithm | Time | Space | Key Condition |
|-----------|------|-------|---------------|
| BFS | O(V+E) | O(V) | Unweighted |
| DFS | O(V+E) | O(V) | Any graph |
| Dijkstra | O((V+E)logV) | O(V) | Non-negative weights |
| Bellman-Ford | O(VE) | O(V) | Any weights |
| Floyd-Warshall | O(V^3) | O(V^2) | All-pairs |
| Prim | O((V+E)logV) | O(V) | MST, dense graphs |
| Kruskal | O(ElogE) | O(V) | MST, sparse graphs |

## Algorithm Selection Guide

| Scenario | Recommended | Notes |
|----------|------------|-------|
| Unweighted shortest path | BFS | Minimum edge count |
| Non-negative weighted shortest path | Dijkstra | With priority queue |
| Negative weights / detect negative cycles | Bellman-Ford | Can detect negative cycles |
| All-pairs shortest path | Floyd-Warshall | Simple code, dense graphs |
| Dense graph MST | Prim | O(V^2) with adjacency matrix |
| Sparse graph MST | Kruskal | Requires edge sorting |

## Practice Problems

### BFS

- LC 127 - Word Ladder
- LC 200 - Number of Islands
- LC 542 - 01 Matrix

### DFS

- LC 207 - Course Schedule
- LC 399 - Evaluate Division
- LC 695 - Max Area of Island

### Dijkstra

- LC 743 - Network Delay Time
- LC 778 - Swim in Rising Water
- LC 1631 - Path With Minimum Effort

### MST

- LC 1584 - Min Cost to Connect All Points
- LC 1135 - Connecting Cities With Minimum Cost

## Related Topics

- BFS - breadth-first search details
- DFS - depth-first search details
- Dijkstra - weighted shortest path details
- Dynamic Programming - graph DP problems
