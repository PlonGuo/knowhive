---
title: Dijkstra's Algorithm
category: Shortest Path
tags: [dijkstra, graph, shortest-path, greedy, heap, priority-queue]
difficulty: null
pack_id: leetcode-basics
---

# Dijkstra's Algorithm

## Core Idea

- Greedy algorithm that always selects the node with the smallest current distance
- Works on directed/undirected graphs with non-negative edge weights
- Solves the single-source shortest path problem

## Key Properties

1. **Distance array** - tracks shortest distance from source to each node
2. **Priority queue** - min-heap ordered by distance
3. **Relaxation** - update shorter paths through the current node to its neighbors

## Use Cases

### 1. Single-Source Shortest Path

- Network delay time calculation
- Map navigation shortest route
- Optimal resource allocation path

### 2. Non-Negative Weight Graphs

- Distance, time, cost, and other non-negative metrics
- Cannot handle negative-weight edges

## Code Templates

### Basic Dijkstra

```python
import heapq

def dijkstra(graph, start):
    """
    graph: adjacency list, graph[u] = [(v, weight), ...]
    start: source node
    Returns: shortest distance from start to all nodes
    """
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

### Dijkstra with Path Reconstruction

```python
def dijkstra_with_path(graph, start, end):
    n = len(graph)
    dist = [float('inf')] * n
    dist[start] = 0
    prev = [-1] * n

    heap = [(0, start)]

    while heap:
        curr_dist, node = heapq.heappop(heap)

        if curr_dist > dist[node]:
            continue

        if node == end:
            break

        for neighbor, weight in graph[node]:
            new_dist = curr_dist + weight

            if new_dist < dist[neighbor]:
                dist[neighbor] = new_dist
                prev[neighbor] = node
                heapq.heappush(heap, (new_dist, neighbor))

    path = []
    node = end
    while node != -1:
        path.append(node)
        node = prev[node]
    path.reverse()

    return dist[end], path
```

### Grid Dijkstra

```python
def dijkstra_grid(grid, start):
    """
    grid: 2D grid where grid[r][c] is the weight at that cell
    start: (r, c) starting position
    """
    rows, cols = len(grid), len(grid[0])
    dist = [[float('inf')] * cols for _ in range(rows)]
    dist[start[0]][start[1]] = grid[start[0]][start[1]]

    heap = [(grid[start[0]][start[1]], start[0], start[1])]
    directions = [(0, 1), (0, -1), (1, 0), (-1, 0)]

    while heap:
        curr_dist, r, c = heapq.heappop(heap)

        if curr_dist > dist[r][c]:
            continue

        for dr, dc in directions:
            nr, nc = r + dr, c + dc

            if 0 <= nr < rows and 0 <= nc < cols:
                new_dist = curr_dist + grid[nr][nc]

                if new_dist < dist[nr][nc]:
                    dist[nr][nc] = new_dist
                    heapq.heappush(heap, (new_dist, nr, nc))

    return dist
```

## Complexity

- **Time**: O((V + E) log V) - with priority queue
- **Space**: O(V) - distance array and heap

## Practice Problems

### Basic

1. LC 743 - Network Delay Time (classic Dijkstra application)
2. LC 1514 - Path with Maximum Probability (Dijkstra variant, maximize probability)

### Grid Applications

3. LC 778 - Swim in Rising Water (2D grid Dijkstra, minimize max value on path)
4. LC 1631 - Path With Minimum Effort (minimize max height difference on path)

### Advanced Applications

5. LC 1334 - Find the City With the Smallest Number of Neighbors (multiple Dijkstra runs)
6. LC 882 - Reachable Nodes In Subdivided Graph (Dijkstra with node subdivision)

## Interview Tips

1. **Non-negative weights**: confirm all weights are non-negative before using Dijkstra
2. **Priority queue optimization**: must use min-heap; otherwise complexity degrades to O(V^2)
3. **Skip stale entries**: heap may contain outdated distances; check before processing
4. **Early termination**: if only need distance to a specific target, stop when it's dequeued
5. **Variant recognition**:
   - Minimize path maximum value - Dijkstra variant
   - Maximize probability - take logarithm to convert to addition
   - Constrained shortest path - state-expanded Dijkstra

## Related Topics

- Graph Theory Overview - parent topic
- BFS - unweighted shortest path
- Bellman-Ford - handles negative weights
